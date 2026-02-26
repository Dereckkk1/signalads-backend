
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import path from 'path';
import dotenv from 'dotenv';
import { User } from '../models/User';
import { Product } from '../models/Product'; // Assumes Product.ts is in models

// Load environment variables
dotenv.config();

const DATA_DIR = path.join(__dirname, '../../data');
const RADIOS_FILE = path.join(DATA_DIR, 'radios.xlsx');
const PRODUCTS_FILE = path.join(DATA_DIR, 'Produtos.xlsx');
const PMM_FILE = path.join(DATA_DIR, 'PMM.xlsx');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://tatico3:8b990aOzLf7Cp3f8@signalads.edtljjf.mongodb.net/?appName=SignalAds';

// Define Interfaces
interface RelatRow {
    'Nome'?: string;
    'Cidade'?: string;
    'UF'?: string;
    'E-mail'?: string;
    'Telefone'?: string;
    'CPF/CNPJ'?: string;
    'Endereço'?: string;
    'Site'?: string;
    'Key'?: string;
}

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

const parseAddress = (addressStr: string) => {
    const result = {
        street: '',
        number: '',
        complement: '',
        neighborhood: '',
        cep: ''
    };

    if (!addressStr) return result;

    const cepMatch = addressStr.match(/(?:CEP:?|cep:?)\s*(\d{5}-?\d{3})/i);
    if (cepMatch && cepMatch[1]) {
        result.cep = cepMatch[1];
        addressStr = addressStr.replace(cepMatch[0], '').trim();
    }

    addressStr = addressStr.replace(/[,\- ]+$/, '');
    const parts = addressStr.split(/\s+-\s+/);

    if (parts.length > 0 && parts[0]) {
        const streetPart = parts[0] || '';
        const commaIndex = streetPart.lastIndexOf(',');

        if (commaIndex > -1) {
            result.street = streetPart.substring(0, commaIndex).trim();
            result.number = streetPart.substring(commaIndex + 1).trim();
        } else {
            const spaceMatch = streetPart.match(/^(.*)\s+(\d+|s\/n)$/i);
            if (spaceMatch && spaceMatch[1]) {
                result.street = spaceMatch[1].trim();
                result.number = (spaceMatch[2] || '').trim();
            } else {
                result.street = streetPart.trim();
            }
        }
    }

    if (parts.length === 2 && parts[1]) {
        result.neighborhood = parts[1].trim();
    } else if (parts.length >= 3) {
        const neighborhoodPart = parts[parts.length - 1];
        if (neighborhoodPart) result.neighborhood = neighborhoodPart.trim();
        result.complement = parts.slice(1, parts.length - 1).join(', ').trim();
    }

    return result;
};


const connectDB = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('📦 Connected to MongoDB');
    } catch (err: any) {
        console.error('Error connecting to MongoDB:', err);
        process.exit(1);
    }
};

const runMigration = async () => {
    await connectDB();

    // LIMPEZA: Deletar todos os registros gerenciados pelo admin antes de migrar
    console.log('🧹 Limpando emissoras gerenciadas pelo admin...');
    const deleteRes = await User.deleteMany({ managedByAdmin: true });
    console.log(`✅ Foram removidos ${deleteRes.deletedCount} registros antigos.`);

    // 1. Load Radios
    console.log(`Reading Radios file: ${RADIOS_FILE}`);
    let radiosData: RadiosRow[] = [];
    let citiesMap = new Map<string, MunicipalityRow>();

    try {
        const radiosWb = XLSX.readFile(RADIOS_FILE);

        let targetSheet = radiosWb.Sheets['Rádios'];
        if (!targetSheet && radiosWb.SheetNames.length > 0) {
            const firstSheet = radiosWb.SheetNames[0];
            if (firstSheet) targetSheet = radiosWb.Sheets[firstSheet];
        }

        if (targetSheet) {
            radiosData = XLSX.utils.sheet_to_json(targetSheet);
        }

        const muniSheet = radiosWb.Sheets['Cópia de DTB_2022_Municipio'];
        if (muniSheet) {
            const muniData: MunicipalityRow[] = XLSX.utils.sheet_to_json(muniSheet);
            muniData.forEach(m => {
                if (m.ID_Município) {
                    citiesMap.set(String(m.ID_Município).trim(), m);
                }
            });
            console.log(`Loaded ${citiesMap.size} municipalities`);
        } else {
            console.warn("Sheet 'Cópia de DTB_2022_Municipio' not found!");
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
        const sheetName = prodWb.SheetNames[0];
        if (sheetName) {
            const prodSheet = prodWb.Sheets[sheetName];
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
        }
        console.log(`Loaded products for ${productMap.size} unique radios`);
    } catch (e) {
        console.error("Error reading Products file", e);
    }

    // 3. Load PMM
    console.log(`Reading PMM file: ${PMM_FILE}`);
    let pmmMap = new Map<string, { opm?: number, pmm?: number }>();
    try {
        const pmmWb = XLSX.readFile(PMM_FILE);
        const sheetName = pmmWb.SheetNames[0];
        if (sheetName) {
            const pmmSheet = pmmWb.Sheets[sheetName];
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
        }
        console.log(`Loaded PMM data for ${pmmMap.size} rows`);
    } catch (e) {
        console.error("Error reading PMM file", e);
    }

    let processedCount = 0;
    let skippedCount = 0;

    for (const radio of radiosData) {
        let userData: any;
        const passwordHash = '$2a$10$YourHashedPasswordHere';
        let query: any;

        try {
            // Identify Broadcaster using composite key: Station Name + Dial + UF
            // relat_veiculo matching REMOVED - using only Radios data

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
                        if (!radio.estilo) radio.estilo = fallbackNetworkRadio.estilo;
                        if (!radio.classeAB && !radio.classeC && !radio.classeDE) {
                            radio.classeAB = fallbackNetworkRadio.classeAB;
                            radio.classeC = fallbackNetworkRadio.classeC;
                            radio.classeDE = fallbackNetworkRadio.classeDE;
                        }
                        if (!radio.genero) radio.genero = fallbackNetworkRadio.genero;
                        if (!radio.idade) radio.idade = fallbackNetworkRadio.idade;
                    }
                }
            }

            // --- VALIDATION: Only Radio fields are required ---
            const requiredRadioFields: (keyof RadiosRow)[] = [
                'Row ID', 'classeAB', 'classeC', 'classeDE',
                'uf', 'praca', 'emissora', 'dial', 'estilo', 'genero', 'idade'
            ];

            let missingField = false;
            for (const field of requiredRadioFields) {
                const val = radio[field];
                if (val === undefined || val === null || val === '') {
                    missingField = true;
                    break;
                }
            }
            // Universo is no longer mandatory, will default to 0 if not found
            if (missingField) {
                skippedCount++;
                continue;
            }
            // --- END VALIDATION ---

            // Generate email and phone (placeholders)
            let email = `catalog_${normalizeString(radio.emissora)}_${normalizeString(radio.dial)}_${normalizeString(String(radio.praca))}@eradios.com.br`;
            let phone = '0000000000';
            let cleanCnpj = `CATALOG${radio['Row ID']}`;
            // Resolve City Code and Coords
            let cityName = radio.praca;
            let cityState = radio.uf;
            let latitude: number | undefined = undefined;
            let longitude: number | undefined = undefined;

            if (/^\d+$/.test(String(radio.praca))) {
                const muni = citiesMap.get(String(radio.praca));
                if (muni) {
                    cityName = muni.Nome_Município;
                    if (muni.UF) cityState = muni.UF;
                    latitude = muni.LATITUDE;
                    longitude = muni.LONGITUDE;
                }
            }

            const addressData = {
                cep: '',
                street: '',
                number: '',
                complement: '',
                neighborhood: '',
                city: cityName || '',
                state: cityState || '',
                latitude: latitude,
                longitude: longitude
            };

            // Categories and other data
            const categories = radio.estilo ? radio.estilo.split(',').map(s => s.trim()) : [];
            const band = (radio.dial && String(radio.dial).includes('.')) ? 'FM' : 'AM';
            const coverageCities = radio.pracasAbrangencia ? radio.pracasAbrangencia.split(',').map(s => s.trim()) : [];
            const genderStats = parsePercentage(radio.genero);

            // PMM Logic
            let pmmValue: number | undefined = undefined;
            if (radio['nomePmm']) {
                const pmmData = pmmMap.get(String(radio['nomePmm']).trim());
                if (pmmData) {
                    if (pmmData.opm !== undefined) pmmValue = pmmData.opm;
                    else if (pmmData.pmm !== undefined) pmmValue = pmmData.pmm;
                }
            }

            // Filter out broadcasters without PMM/OPM
            if (pmmValue === undefined) {
                skippedCount++;
                // process.stdout.write('S'); // Skipped
                continue;
            }

            userData = {
                name: radio.emissora,
                email: email.toLowerCase(),
                userType: 'broadcaster',
                status: 'approved',
                cpfOrCnpj: cleanCnpj,
                cnpj: cleanCnpj,
                companyName: radio.emissora,
                fantasyName: radio.emissora,
                phone: phone,
                address: addressData,
                favorites: [],
                onboardingCompleted: true,
                broadcasterProfile: {
                    generalInfo: {
                        stationName: radio.emissora,
                        dialFrequency: radio.dial ? String(radio.dial) : '',
                        band: band,
                        antennaClass: radio.classeAntena || 'A4'
                    },
                    logo: radio.logo || '',
                    comercialEmail: email.toLowerCase(),
                    website: '',
                    categories: categories,
                    audienceProfile: {
                        gender: genderStats || { male: 50, female: 50 },
                        ageRange: radio.idade || '',
                        socialClass: {
                            classeAB: radio.classeAB || 0,
                            classeC: radio.classeC || 0,
                            classeDE: radio.classeDE || 0
                        }
                    },
                    coverage: {
                        cities: coverageCities,
                        totalPopulation: universe || 0,
                        states: []
                    },
                    pmm: pmmValue
                },
                twoFactorEnabled: false,
                isCatalogOnly: true,
                managedByAdmin: true,
                createdBy: new mongoose.Types.ObjectId("69285e5e1a21a8368d9960c0"),
                trustedDevices: []
            };

            query = { email: userData.email };

            const upsertRes = await User.findOneAndUpdate(
                query,
                { $set: userData, $setOnInsert: { password: passwordHash } },
                { upsert: true, new: true, lean: true }
            );

            // --- PRODUCT IMPORT LOGIC ---
            if (upsertRes && radio['Row ID']) {
                const userId = upsertRes._id;
                const productsRaw = productMap.get(String(radio['Row ID']).trim());

                if (productsRaw && productsRaw.length > 0) {
                    // Check for manually edited products before deleting
                    const editedProducts = await Product.find({
                        broadcasterId: userId,
                        manuallyEdited: true
                    }).lean();

                    // Build a map of manually edited prices by spotType
                    const editedPriceMap = new Map<string, number>();
                    for (const ep of editedProducts) {
                        editedPriceMap.set(ep.spotType, ep.pricePerInsertion);
                    }

                    // Delete existing products for this user (for idempotency)
                    await Product.deleteMany({ broadcasterId: userId });

                    const productsToInsert: any[] = [];

                    for (const p of productsRaw) {
                        // V2 + 50%
                        const basePrice = (Number(p['V2']) || 0) * 1.65;
                        if (basePrice <= 0) continue;

                        const productName = p['Produto'] ? p['Produto'].trim() : '';

                        if (productName === 'Spot 30') {
                            // Use manually edited 30s price if available, otherwise Excel price
                            const edited30s = editedPriceMap.get('Comercial 30s');
                            const price30s = edited30s !== undefined ? edited30s : basePrice;
                            const wasEdited = edited30s !== undefined;

                            productsToInsert.push(
                                {
                                    broadcasterId: userId, spotType: 'Comercial 15s', duration: 15, timeSlot: 'Rotativo',
                                    pricePerInsertion: wasEdited ? price30s / 2 : basePrice * 0.75,
                                    isActive: true, manuallyEdited: wasEdited
                                },
                                {
                                    broadcasterId: userId, spotType: 'Comercial 30s', duration: 30, timeSlot: 'Rotativo',
                                    pricePerInsertion: price30s, isActive: true, manuallyEdited: wasEdited
                                },
                                {
                                    broadcasterId: userId, spotType: 'Comercial 45s', duration: 45, timeSlot: 'Rotativo',
                                    pricePerInsertion: wasEdited ? price30s * 1.5 : basePrice * 1.5,
                                    isActive: true, manuallyEdited: wasEdited
                                },
                                {
                                    broadcasterId: userId, spotType: 'Comercial 60s', duration: 60, timeSlot: 'Rotativo',
                                    pricePerInsertion: wasEdited ? price30s * 2 : basePrice * 2,
                                    isActive: true, manuallyEdited: wasEdited
                                }
                            );
                        } else if (productName === 'Testemunhal 60') {
                            // Use manually edited 30s price if available
                            const edited30s = editedPriceMap.get('Testemunhal 30s');
                            const price30s = edited30s !== undefined ? edited30s : basePrice / 2;
                            const wasEdited = edited30s !== undefined;

                            productsToInsert.push(
                                {
                                    broadcasterId: userId, spotType: 'Testemunhal 30s', duration: 30, timeSlot: 'Rotativo',
                                    pricePerInsertion: price30s, isActive: true, manuallyEdited: wasEdited
                                },
                                {
                                    broadcasterId: userId, spotType: 'Testemunhal 60s', duration: 60, timeSlot: 'Rotativo',
                                    pricePerInsertion: wasEdited ? price30s * 2 : basePrice,
                                    isActive: true, manuallyEdited: wasEdited
                                }
                            );
                        }
                    }

                    if (productsToInsert.length > 0) {
                        try {
                            await Product.insertMany(productsToInsert);
                            // console.log(`Inserted ${productsToInsert.length} products for ${radio.emissora}`);
                        } catch (prodErr) {
                            console.error(`Error inserting products for ${radio.emissora}`, prodErr);
                        }
                    }
                }
            }
            // --- END PRODUCT IMPORT ---

            processedCount++;
            process.stdout.write('.');

        } catch (err: any) {
            // Handle duplicates logic similar to before, but for brevity (and since we rely on email mapping mainly now for updates)
            // we will just log error. (User updates by email = unique).
            // If CNPJ conflict, retry logic:
            if (err.code === 11000 && (err.keyPattern?.cpfOrCnpj || err.errmsg?.includes('cpfOrCnpj'))) {
                try {
                    // Suffix CNPJ
                    if (userData) {
                        userData.cpfOrCnpj = `${userData.cpfOrCnpj}_${Math.floor(Math.random() * 100000)}`;
                        // Re-try upsert
                        const retryRes = await User.findOneAndUpdate(
                            query,
                            { $set: userData, $setOnInsert: { password: passwordHash } },
                            { upsert: true, new: true, lean: true }
                        );
                        // If successful, do products (Code duplication here, simplified for now)
                        // Ideally extract product logic function.
                        if (retryRes && radio['Row ID']) {
                            const userId = retryRes._id;
                            const productsRaw = productMap.get(String(radio['Row ID']).trim());
                            if (productsRaw && productsRaw.length > 0) {
                                // Check for manually edited products before deleting
                                const editedProducts = await Product.find({
                                    broadcasterId: userId,
                                    manuallyEdited: true
                                }).lean();
                                const editedPriceMap = new Map<string, number>();
                                for (const ep of editedProducts) {
                                    editedPriceMap.set(ep.spotType, ep.pricePerInsertion);
                                }

                                await Product.deleteMany({ broadcasterId: userId });
                                const productsToInsert: any[] = [];
                                for (const p of productsRaw) {
                                    const basePrice = (Number(p['V2']) || 0) * 1.65;
                                    if (basePrice <= 0) continue;
                                    const productName = p['Produto'] ? p['Produto'].trim() : '';
                                    if (productName === 'Spot 30') {
                                        const edited30s = editedPriceMap.get('Comercial 30s');
                                        const price30s = edited30s !== undefined ? edited30s : basePrice;
                                        const wasEdited = edited30s !== undefined;
                                        productsToInsert.push(
                                            { broadcasterId: userId, spotType: 'Comercial 15s', duration: 15, timeSlot: 'Rotativo', pricePerInsertion: wasEdited ? price30s / 2 : basePrice * 0.75, isActive: true, manuallyEdited: wasEdited },
                                            { broadcasterId: userId, spotType: 'Comercial 30s', duration: 30, timeSlot: 'Rotativo', pricePerInsertion: price30s, isActive: true, manuallyEdited: wasEdited },
                                            { broadcasterId: userId, spotType: 'Comercial 45s', duration: 45, timeSlot: 'Rotativo', pricePerInsertion: wasEdited ? price30s * 1.5 : basePrice * 1.5, isActive: true, manuallyEdited: wasEdited },
                                            { broadcasterId: userId, spotType: 'Comercial 60s', duration: 60, timeSlot: 'Rotativo', pricePerInsertion: wasEdited ? price30s * 2 : basePrice * 2, isActive: true, manuallyEdited: wasEdited }
                                        );
                                    } else if (productName === 'Testemunhal 60') {
                                        const edited30s = editedPriceMap.get('Testemunhal 30s');
                                        const price30s = edited30s !== undefined ? edited30s : basePrice / 2;
                                        const wasEdited = edited30s !== undefined;
                                        productsToInsert.push(
                                            { broadcasterId: userId, spotType: 'Testemunhal 30s', duration: 30, timeSlot: 'Rotativo', pricePerInsertion: price30s, isActive: true, manuallyEdited: wasEdited },
                                            { broadcasterId: userId, spotType: 'Testemunhal 60s', duration: 60, timeSlot: 'Rotativo', pricePerInsertion: wasEdited ? price30s * 2 : basePrice, isActive: true, manuallyEdited: wasEdited }
                                        );
                                    }
                                }
                                if (productsToInsert.length > 0) await Product.insertMany(productsToInsert);
                            }
                        }
                        processedCount++;
                        process.stdout.write('+');
                    }
                } catch (retryErr) {
                    process.stdout.write('x');
                }
            } else {
                process.stdout.write('E');
            }
        }
    }

    console.log(`\nMigration Complete!`);
    console.log(`Processed: ${processedCount}, Skipped: ${skippedCount}`);
    await mongoose.disconnect();
};

runMigration();
