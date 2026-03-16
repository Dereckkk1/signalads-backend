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
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const CACHE_MAX_FILES = 5000;

// Garante que o diretório existe
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Limpeza periódica do cache: remove arquivos >7 dias e limita a 5000 arquivos
const cleanupCache = () => {
    try {
        const files = fs.readdirSync(CACHE_DIR)
            .map(name => {
                const filePath = path.join(CACHE_DIR, name);
                const stat = fs.statSync(filePath);
                return { name, filePath, mtimeMs: stat.mtimeMs, size: stat.size };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);

        const now = Date.now();
        let deleted = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i]!;
            const isExpired = (now - file.mtimeMs) > CACHE_MAX_AGE_MS;
            const isOverLimit = i >= CACHE_MAX_FILES;

            if (isExpired || isOverLimit) {
                try { fs.unlinkSync(file.filePath); deleted++; } catch {}
            }
        }
    } catch {}
};

// Executa limpeza na inicialização e a cada 6 horas
cleanupCache();
setInterval(cleanupCache, 6 * 60 * 60 * 1000);

export const getAppSheetImage = async (req: Request, res: Response) => {
    try {
        const { fileName } = req.query;

        if (!fileName || typeof fileName !== 'string') {
            return res.status(400).send('fileName is required');
        }

        // Protecao contra SSRF: apenas URLs HTTPS do dominio AppSheet sao permitidas
        if (fileName.startsWith('http')) {
            const allowedDomains = ['appsheet.com', 'www.appsheet.com'];
            try {
                const urlObj = new URL(fileName);
                // Apenas HTTPS permitido
                if (urlObj.protocol !== 'https:') {
                    return res.status(403).send('Only HTTPS allowed');
                }
                const isAllowed = allowedDomains.some(domain => urlObj.hostname === domain || urlObj.hostname.endsWith('.' + domain));
                if (!isAllowed) {
                    return res.status(403).send('Domain not allowed');
                }
                // Bloqueia IPs internos/privados no hostname
                if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|localhost|169\.254\.|::1|\[::)/.test(urlObj.hostname)) {
                    return res.status(403).send('Internal addresses not allowed');
                }
                return res.redirect(fileName);
            } catch {
                return res.status(400).send('Invalid URL');
            }
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

        // 3. Ao invés de pipe duplo (vaza memória e trava requisições se um falhar),
        // vamos usar o pipe apenas para a Response, e salvar usando os eventos de stream originais.

        response.data.pipe(res);

        const chunks: Buffer[] = [];
        response.data.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });

        response.data.on('end', () => {
            // Quando terminar o download com sucesso completo, salva no cache assincronamente
            const fullBuffer = Buffer.concat(chunks);
            if (fullBuffer.length > 0) {
                fs.writeFile(cachedFilePath, fullBuffer, (err) => {
                    // Cache write error silenced
                });
            }
        });

        response.data.on('error', (err: any) => {
            if (!res.headersSent) {
                res.status(502).send('Error fetching image');
            }
        });

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).send('Internal Server Error');
        }
    }
};
