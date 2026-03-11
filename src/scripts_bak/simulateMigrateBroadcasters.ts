
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

// Use placeholders for User/Product models to avoid DB interaction errors if they are not fully loaded/needed
// But we still need the types or just use 'any' for simulation
import { User } from '../models/User';
import { Product } from '../models/Product';

// Load environment variables
dotenv.config();

const DATA_DIR = path.join(__dirname, '../../data');
const RADIOS_FILE = path.join(DATA_DIR, 'radios.xlsx');
const PRODUCTS_FILE = path.join(DATA_DIR, 'Produtos.xlsx');
const PMM_FILE = path.join(DATA_DIR, 'PMM.xlsx');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://tatico3:8b990aOzLf7Cp3f8@signalads.edtljjf.mongodb.net/?appName=SignalAds';

// Define Interfaces
interface RadiosRow {
    'Row ID': string;
    'nomePmm'?: string;
    classeAB?: number;
    classeC?: number;
    classeDE?: number;
    classeAntena?: string;
    uf: string;
    praca: string;
    emissora: string;
    dial: string;
    estilo?: string;
    genero?: string;
    idade?: string;
    universo?: number;
    logo?: string;
    pracasAbrangencia?: string;
}

interface MunicipalityRow {
    'ID_Município': number | string;
    'Nome_Município': string;
    'UF': string;
    'LATITUDE'?: number;
    'LONGITUDE'?: number;
}

interface ProductRow {
    'Rádio': string; // Matches 'Row ID'
    'Produto': string; // "Spot 30" or "Testemunhal 60"
    'V2': number; // Base Price
}

interface PmmRow {
    'Row ID': string;
    'PMM'?: number | string;
    'OPM'?: number | string;
}

// Helpers
const normalizeString = (str: string | undefined | number): string => {
    if (!str && str !== 0) return '';
    return String(str).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
};

const parsePercentage = (str: string | undefined | number): { male: number, female: number } | undefined => {
    if (!str && str !== 0) return undefined;
    const lower = String(str).toLowerCase();
    const match = lower.match(/(\d+)%/);
    if (match && match[1]) {
        const val = parseInt(match[1], 10);
        if (lower.includes('fem') || lower.includes('mulher')) {
            return { female: val, male: 100 - val };
        } else if (lower.includes('masc') || lower.includes('homem')) {
            return { male: val, female: 100 - val };
        }
    }
    return undefined;
};

const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('📦 Connected to MongoDB (ReadOnly Mode)');
    } catch (err: any) {
        console.error('Error connecting to MongoDB:', err);
        process.exit(1);
    }
};

const runSimulation = async () => {
    await connectDB();

    console.log('🧪 INICIANDO SIMULAÇÃO DE MIGRAÇÃO...');
    console.log('--------------------------------------');

    // 1. Load Radios
    console.log(`Reading Radios file: ${RADIOS_FILE}`);
    let radiosData: RadiosRow[] = [];
    let citiesMap = new Map<string, MunicipalityRow>();

    try {
        const radiosWb = XLSX.readFile(RADIOS_FILE);
        const firstSheetName = radiosWb.SheetNames[0];
        let targetSheet = radiosWb.Sheets['Rádios'] || (firstSheetName ? radiosWb.Sheets[firstSheetName] : undefined);
        if (targetSheet) {
            radiosData = XLSX.utils.sheet_to_json(targetSheet);
        }

        const muniSheet = radiosWb.Sheets['Cópia de DTB_2022_Municipio'];
        if (muniSheet) {
            const muniData: MunicipalityRow[] = XLSX.utils.sheet_to_json(muniSheet);
            muniData.forEach(m => {
                if (m.ID_Município) citiesMap.set(String(m.ID_Município).trim(), m);
            });
        }
    } catch (e) {
        console.error("Error reading Radios file", e);
    }
    console.log(`Loaded ${radiosData.length} rows from Radios`);

    // 2. Load Products
    console.log(`Reading Products file: ${PRODUCTS_FILE}`);
    let productMap = new Map<string, ProductRow[]>();
    try {
        const prodWb = XLSX.readFile(PRODUCTS_FILE);
        const firstSheetName = prodWb.SheetNames[0];
        const prodSheet = firstSheetName ? prodWb.Sheets[firstSheetName] : undefined;
        if (prodSheet) {
            const prodRaw: ProductRow[] = XLSX.utils.sheet_to_json(prodSheet);
            prodRaw.forEach(row => {
                if (row['Rádio'] !== undefined && row['Rádio'] !== null) {
                    const rid = String(row['Rádio']).trim();
                    const current = productMap.get(rid) || [];
                    current.push(row);
                    productMap.set(rid, current);
                }
            });
        }
    } catch (e) {
        console.error("Error reading Products file", e);
    }

    // 3. Load PMM
    console.log(`Reading PMM file: ${PMM_FILE}`);
    let pmmMap = new Map<string, { opm?: number, pmm?: number }>();
    try {
        const pmmWb = XLSX.readFile(PMM_FILE);
        const firstSheetName = pmmWb.SheetNames[0];
        const pmmSheet = firstSheetName ? pmmWb.Sheets[firstSheetName] : undefined;
        if (pmmSheet) {
            const pmmRaw: PmmRow[] = XLSX.utils.sheet_to_json(pmmSheet);
            pmmRaw.forEach(row => {
                const rid = String(row['Row ID']).trim();
                const opmVal = typeof row['OPM'] === 'number' ? row['OPM'] : parseFloat(String(row['OPM']).replace(',', '.'));
                const pmmVal = typeof row['PMM'] === 'number' ? row['PMM'] : parseFloat(String(row['PMM']).replace(',', '.'));
                if (rid && rid !== 'undefined') {
                    pmmMap.set(rid, {
                        opm: isNaN(opmVal) ? undefined : opmVal,
                        pmm: isNaN(pmmVal) ? undefined : pmmVal
                    });
                }
            });
        }
    } catch (e) {
        console.error("Error reading PMM file", e);
    }

    let processedCount = 0;
    let skippedCount = 0;
    const details: string[] = [];

    console.log('\nEMISSORAS:\n');

    for (const radio of radiosData) {
        try {
            // --- FALLBACK: Universo ---
            let universe = radio.universo;
            if (!universe || universe === 0) {
                // Tenta achar outra rádio na mesma cidade e mesma classe de antena que tenha universo
                const fallbackRadio = radiosData.find(r =>
                    r.praca === radio.praca &&
                    r.classeAntena === radio.classeAntena &&
                    r.universo && r.universo > 0
                );
                if (fallbackRadio) {
                    universe = fallbackRadio.universo;
                }
            }

            // --- FALLBACK: Rede (Estilo, Classes, Gênero e Idade) ---
            const NETWORKS = ['nativa', 'pan', 'massa', 'dbn', 'band', 'boas novas', 'nova brasil', 'band news', 'mix'];
            const radioNameNorm = normalizeString(radio.emissora);
            const foundNetwork = NETWORKS.find(net => {
                const netNorm = normalizeString(net);
                if (netNorm === 'nativa' && radioNameNorm.includes('alternativa')) return false;
                return radioNameNorm.includes(netNorm);
            });

            if (foundNetwork) {
                if (!radio.estilo || (!radio.classeAB && !radio.classeC && !radio.classeDE) || !radio.genero || !radio.idade) {
                    const fallbackNetworkRadio = radiosData.find(r => {
                        const rNameNorm = normalizeString(r.emissora);
                        const rNetMatch = rNameNorm.includes(normalizeString(foundNetwork));
                        const rNoAlt = normalizeString(foundNetwork) === 'nativa' ? !rNameNorm.includes('alternativa') : true;
                        return rNetMatch && rNoAlt && r.estilo && (r.classeAB !== undefined || r.classeC !== undefined || r.classeDE !== undefined) && r.genero && r.idade;
                    });

                    if (fallbackNetworkRadio) {
                        let applied = [];
                        if (!radio.estilo) { radio.estilo = fallbackNetworkRadio.estilo; applied.push('estilo'); }
                        if (!radio.classeAB && !radio.classeC && !radio.classeDE) {
                            radio.classeAB = fallbackNetworkRadio.classeAB;
                            radio.classeC = fallbackNetworkRadio.classeC;
                            radio.classeDE = fallbackNetworkRadio.classeDE;
                            applied.push('classes');
                        }
                        if (!radio.genero) { radio.genero = fallbackNetworkRadio.genero; applied.push('genero'); }
                        if (!radio.idade) { radio.idade = fallbackNetworkRadio.idade; applied.push('idade'); }

                        if (applied.length > 0) {
                            // console.log(`[REDE] ${radio.emissora} (${displayCity}) preencheu ${applied.join(', ')} via rede ${foundNetwork}`);
                        }
                    }
                }
            }

            const requiredRadioFields: (keyof RadiosRow)[] = [
                'Row ID', 'classeAB', 'classeC', 'classeDE',
                'uf', 'praca', 'emissora', 'dial', 'estilo', 'genero', 'idade'
            ];

            let missingField: string | null = null;
            for (const field of requiredRadioFields) {
                const val = radio[field];
                if (val === undefined || val === null || val === '') {
                    missingField = String(field);
                    break;
                }
            }

            // Resolve City Name for Log
            let displayCity = String(radio.praca);
            if (/^\d+$/.test(displayCity)) {
                const muni = citiesMap.get(displayCity);
                if (muni) displayCity = muni.Nome_Município;
            }

            if (missingField) {
                skippedCount++;
                details.push(`${radio.emissora || 'SEM NOME'} | dial: ${radio.dial || '--'} | cidade: ${displayCity} - skipped (motivo: campo obrigatório '${missingField}' vazio)`);
                continue;
            }

            // Universo is no longer a blocker, we'll use universe || 0 later
            // if (!universe) { 
            //    // Opting not to log this as error anymore since it's allowed
            // }

            // PMM Logic
            let pmmValue: number | undefined = undefined;
            if (radio['nomePmm']) {
                const pmmData = pmmMap.get(String(radio['nomePmm']).trim());
                if (pmmData) {
                    if (pmmData.opm !== undefined) pmmValue = pmmData.opm;
                    else if (pmmData.pmm !== undefined) pmmValue = pmmData.pmm;
                }
            }

            if (pmmValue === undefined) {
                skippedCount++;
                details.push(`${radio.emissora} | dial: ${radio.dial} | cidade: ${displayCity} - skipped (motivo: PMM/OPM não encontrado para '${radio['nomePmm']}')`);
                continue;
            }

            // Product check
            const productsRaw = productMap.get(String(radio['Row ID']).trim());
            if (!productsRaw || productsRaw.length === 0) {
                skippedCount++;
                details.push(`${radio.emissora} | dial: ${radio.dial} | cidade: ${displayCity} - skipped (motivo: sem produtos na planilha)`);
                continue;
            }

            processedCount++;

        } catch (err: any) {
            skippedCount++;
            details.push(`${radio.emissora || '??'} - skipped (motivo: erro inesperado: ${err.message})`);
        }
    }

    // Final summary
    const summaryHeader = '\n--------------------------------------';
    const resultTitle = `RESULTADO FINAL:`;
    const totalLine = `Total a migrar: ${radiosData.length}`;
    const migratedLine = `Migradas: ${processedCount}`;
    const skippedLine = `Skipped: ${skippedCount}`;
    const sessionEnd = '--------------------------------------\nSESSÃO FINALIZADA (SIMULAÇÃO)';

    const fullLog = [
        '🧪 INICIANDO SIMULAÇÃO DE MIGRAÇÃO...',
        '--------------------------------------',
        ...details,
        summaryHeader,
        resultTitle,
        totalLine,
        migratedLine,
        skippedLine,
        summaryHeader,
        sessionEnd
    ].join('\n');

    // Write to file
    const logPath = path.join(__dirname, '../../migration_simulation_log.txt');
    fs.writeFileSync(logPath, fullLog);

    console.log(`\n✅ Simulação concluída! O log detalhado foi salvo em: ${logPath}`);
    console.log(`Total: ${radiosData.length} | Sucesso: ${processedCount} | Falha: ${skippedCount}`);

    await mongoose.disconnect();
};

runSimulation();
