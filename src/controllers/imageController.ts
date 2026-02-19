import { Request, Response } from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import stream from 'stream';

const pipeline = promisify(stream.pipeline);

// Constantes do AppSheet (copiadas do frontend)
const BASE_APP_URL = 'https://www.appsheet.com/image/getimageurl';
const APP_NAME = 'E-Rádios-408183446-24-03-22-2';
const VERSION_RADIOS = '1.002203';
const SIGNATURE_IMAGE = 'a107f1dc96a649316127fec7b49d24ce2c7a224625d288be3423631f42d8ea3f';

// Diretório de cache
const CACHE_DIR = path.join(__dirname, '../../cache/images');

// Garante que o diretório existe
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

export const getAppSheetImage = async (req: Request, res: Response) => {
    try {
        const { fileName } = req.query;

        if (!fileName || typeof fileName !== 'string') {
            return res.status(400).send('fileName is required');
        }

        // Se já for URL completa http, redirecionar ou proxyar (mas AppSheet geralmente envia fileName parcial)
        if (fileName.startsWith('http')) {
            return res.redirect(fileName);
        }

        // Sanitiza o nome do arquivo para usar no disco (remove caracteres ilegais)
        // Usar encodeURIComponent pode gerar nomes muito longos ou estranhos, melhor hash ou limpeza simples
        // Vamos usar encodeURIComponent para garantir unicidade simples
        const safeFileName = encodeURIComponent(fileName);
        const cachedFilePath = path.join(CACHE_DIR, safeFileName);

        // 1. Verificar Cache
        if (fs.existsSync(cachedFilePath)) {
            // Verifica se o arquivo tem tamanho > 0
            const stats = fs.statSync(cachedFilePath);
            if (stats.size > 0) {
                // Serve do cache
                res.setHeader('Content-Type', 'image/jpeg'); // Assumindo JPEG, ou detectar
                res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache longo no navegador (1 ano)
                return fs.createReadStream(cachedFilePath).pipe(res);
            } else {
                // Arquivo vazio/corrompido, deletar
                fs.unlinkSync(cachedFilePath);
            }
        }

        // 2. Fetch do AppSheet
        // Monta URL
        const appSheetUrl = `${BASE_APP_URL}?appName=${encodeURIComponent(APP_NAME)}&tableName=R%C3%A1dios%202&fileName=${encodeURIComponent(fileName)}&appVersion=${VERSION_RADIOS}&signature=${SIGNATURE_IMAGE}`;


        const response = await axios({
            method: 'get',
            url: appSheetUrl,
            responseType: 'stream'
        });

        // Configura headers de resposta
        const contentType = response.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache no navegador por 24h

        // 3. Salvar no Cache e Streamar para o Cliente ao mesmo tempo
        const fileWriter = fs.createWriteStream(cachedFilePath);

        // Pipeline: Response -> (Cliente e Arquivo)
        // O axios stream pode ser pipado para múltiplos destinos?
        // Sim, mas precisa cuidar com backpressure. 
        // A maneira mais segura é response.data.pipe(res) e response.data.pipe(fileWriter)

        response.data.pipe(res);
        response.data.pipe(fileWriter);

        // Tratamento de erros no stream
        fileWriter.on('error', (err) => {
            console.error('Error writing to cache:', err);
            // Não interrompe a resposta pro cliente se falhar o cache
        });

        response.data.on('error', (err: any) => {
            console.error('Error in request stream:', err);
            if (!res.headersSent) {
                res.status(502).send('Error fetching image');
            }
        });

    } catch (error) {
        console.error('Image Proxy Error:', error);
        if (!res.headersSent) {
            res.status(500).send('Internal Server Error');
        }
    }
};
