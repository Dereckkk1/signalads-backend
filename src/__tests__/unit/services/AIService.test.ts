/**
 * Unit tests para AIService.
 * Testa resolveLocation e buildMediaPlan com OpenAI mockado.
 */

// ── Mock OpenAI BEFORE import ──
const mockCreate = jest.fn();

jest.mock('openai', () => {
    const MockOpenAI = jest.fn().mockImplementation(() => ({
        chat: {
            completions: {
                create: mockCreate,
            },
        },
    }));
    return { __esModule: true, default: MockOpenAI };
});

import { AIService, UserCriteria, BroadcasterCandidate } from '../../../services/AIService';

// ─── Setup ─────────────────────────────────────────────────────
let service: AIService;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key-123';
    service = new AIService();
});

// ── Helper: create mock candidates ──
function createCandidate(overrides: Partial<BroadcasterCandidate> = {}): BroadcasterCandidate {
    return {
        id: 'broadcaster-1',
        productId: 'product-1',
        name: 'Radio Teste FM',
        city: 'Sao Paulo',
        state: 'SP',
        audience: { totalListeners: 50000 },
        price: 100,
        coverage: { radius: 50 },
        segments: ['news', 'music'],
        pmm: 30000,
        cpm: 3.33,
        ...overrides,
    };
}

function createCriteria(overrides: Partial<UserCriteria> = {}): UserCriteria {
    return {
        businessDescription: 'Loja de roupas',
        location: 'Sao Paulo',
        objective: 'brand_awareness',
        budget: 10000,
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════
// AIService — constructor
// ═══════════════════════════════════════════════════════════════
describe('AIService — constructor', () => {
    it('deve criar instancia do servico', () => {
        expect(service).toBeInstanceOf(AIService);
    });
});

// ═══════════════════════════════════════════════════════════════
// resolveLocation
// ═══════════════════════════════════════════════════════════════
describe('resolveLocation', () => {
    it('deve retornar cidades e estados da resposta da AI', async () => {
        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        cities: ['Blumenau', 'Itajai', 'Brusque'],
                        states: ['SC'],
                    }),
                },
            }],
        });

        const result = await service.resolveLocation('Vale do Itajai');

        expect(result.cities).toEqual(['Blumenau', 'Itajai', 'Brusque']);
        expect(result.states).toEqual(['SC']);
    });

    it('deve retornar vazio para query curta (menos de 3 chars)', async () => {
        const result = await service.resolveLocation('SP');

        expect(result).toEqual({ cities: [], states: [] });
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('deve retornar vazio para query vazia', async () => {
        const result = await service.resolveLocation('');

        expect(result).toEqual({ cities: [], states: [] });
    });

    it('deve limitar a 10 cidades', async () => {
        const cities = Array.from({ length: 20 }, (_, i) => `City ${i + 1}`);
        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({ cities, states: ['SP'] }),
                },
            }],
        });

        const result = await service.resolveLocation('Interior de SP');

        expect(result.cities).toHaveLength(10);
    });

    it('deve retornar fallback quando AI retorna conteudo vazio', async () => {
        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: { content: null },
            }],
        });

        const result = await service.resolveLocation('Florianopolis');

        expect(result).toEqual({ cities: [], states: [] });
    });

    it('deve retornar fallback quando AI lanca erro', async () => {
        mockCreate.mockRejectedValueOnce(new Error('API Error'));

        const result = await service.resolveLocation('Porto Alegre');

        // Fallback: uses query as city name
        expect(result).toEqual({ cities: ['Porto Alegre'], states: [] });
    });

    it('deve chamar OpenAI com response_format json_object', async () => {
        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({ cities: ['SP'], states: ['SP'] }),
                },
            }],
        });

        await service.resolveLocation('Sao Paulo');

        expect(mockCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                response_format: { type: 'json_object' },
            })
        );
    });
});

// ═══════════════════════════════════════════════════════════════
// buildMediaPlan — sem candidatos
// ═══════════════════════════════════════════════════════════════
describe('buildMediaPlan — sem candidatos', () => {
    it('deve retornar plano vazio quando candidates e array vazio', async () => {
        const criteria = createCriteria();
        const result = await service.buildMediaPlan(criteria, []);

        expect(result.items).toEqual([]);
        expect(result.totalCost).toBe(0);
        expect(result.totalSpots).toBe(0);
        expect(result.totalBroadcasters).toBe(0);
        expect(result.analysis).toContain('No broadcasters found');
    });

    it('deve retornar plano vazio quando candidates e null/undefined', async () => {
        const criteria = createCriteria();
        const result = await service.buildMediaPlan(criteria, null as any);

        expect(result.items).toEqual([]);
        expect(result.totalCost).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════
// buildMediaPlan — resposta normal da AI
// ═══════════════════════════════════════════════════════════════
describe('buildMediaPlan — resposta normal', () => {
    it('deve retornar plano com items enriquecidos do candidate real', async () => {
        const candidate = createCandidate({
            id: 'bc-1',
            productId: 'prod-1',
            name: 'Radio Alpha',
            price: 150,
            city: 'Curitiba',
            state: 'PR',
        });

        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        items: [{
                            broadcasterId: 'bc-1',
                            productId: 'prod-1',
                            broadcasterName: 'Radio Alpha',
                            spots: 44,
                            unitPrice: 150,
                            totalCost: 6600,
                            reasoning: 'Boa eficiencia CPM na regiao',
                        }],
                        analysis: 'Plano otimizado para PR.',
                    }),
                },
            }],
        });

        const result = await service.buildMediaPlan(createCriteria({ budget: 10000 }), [candidate]);

        expect(result.items.length).toBeGreaterThanOrEqual(1);
        // Should use REAL price from candidate, not AI hallucinated price
        expect(result.items[0]!.unitPrice).toBe(150);
        expect(result.items[0]!.broadcasterName).toBe('Radio Alpha');
        expect(result.items[0]!.broadcasterCity).toBe('Curitiba');
        expect(result.items[0]!.broadcasterState).toBe('PR');
    });

    it('deve forcar spots como multiplo de 22 (minimo 22)', async () => {
        const candidate = createCandidate({ id: 'bc-2', price: 50 });

        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        items: [{
                            broadcasterId: 'bc-2',
                            spots: 15, // Not a multiple of 22
                            unitPrice: 50,
                            totalCost: 750,
                            reasoning: 'Test',
                        }],
                        analysis: 'Test',
                    }),
                },
            }],
        });

        // Budget set low enough so the budget-filling loop cannot add more 22-spot blocks
        const result = await service.buildMediaPlan(createCriteria({ budget: 1100 }), [candidate]);

        // 15 should be rounded up to 22 (min and nearest multiple)
        expect(result.items[0]!.spots).toBe(22);
        expect(result.items[0]!.spots % 22).toBe(0);
    });

    it('deve usar preco real do candidate, nao o retornado pela AI', async () => {
        const candidate = createCandidate({ id: 'bc-3', price: 200 });

        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        items: [{
                            broadcasterId: 'bc-3',
                            spots: 22,
                            unitPrice: 999, // AI hallucinated price
                            totalCost: 21978,
                            reasoning: 'Test',
                        }],
                        analysis: 'Test',
                    }),
                },
            }],
        });

        const result = await service.buildMediaPlan(createCriteria(), [candidate]);

        expect(result.items[0]!.unitPrice).toBe(200); // Real price
        expect(result.items[0]!.totalCost).toBe(200 * 22); // Real math
    });

    it('deve filtrar items com broadcasterId que nao existe nos candidates (anti-hallucination)', async () => {
        const candidate = createCandidate({ id: 'real-id' });

        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        items: [
                            { broadcasterId: 'real-id', spots: 22, unitPrice: 100, totalCost: 2200, reasoning: 'ok' },
                            { broadcasterId: 'hallucinated-id', spots: 22, unitPrice: 50, totalCost: 1100, reasoning: 'fake' },
                        ],
                        analysis: 'Test',
                    }),
                },
            }],
        });

        const result = await service.buildMediaPlan(createCriteria(), [candidate]);

        expect(result.items).toHaveLength(1);
        expect(result.items[0]!.broadcasterId).toBe('real-id');
    });

    it('deve deduplicar items com mesmo broadcasterId', async () => {
        const candidate = createCandidate({ id: 'dup-id' });

        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        items: [
                            { broadcasterId: 'dup-id', spots: 22, unitPrice: 100, totalCost: 2200, reasoning: 'first' },
                            { broadcasterId: 'dup-id', spots: 44, unitPrice: 100, totalCost: 4400, reasoning: 'duplicate' },
                        ],
                        analysis: 'Test',
                    }),
                },
            }],
        });

        const result = await service.buildMediaPlan(createCriteria(), [candidate]);

        expect(result.items).toHaveLength(1);
    });
});

// ═══════════════════════════════════════════════════════════════
// buildMediaPlan — emergency fallback
// ═══════════════════════════════════════════════════════════════
describe('buildMediaPlan — emergency fallback', () => {
    it('deve selecionar primeiro candidate quando AI retorna items vazio', async () => {
        const candidate = createCandidate({
            id: 'fallback-1',
            productId: 'fb-prod-1',
            name: 'Radio Fallback',
            price: 75,
        });

        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        items: [],
                        analysis: 'Empty plan',
                    }),
                },
            }],
        });

        const result = await service.buildMediaPlan(createCriteria(), [candidate]);

        expect(result.items).toHaveLength(1);
        expect(result.items[0]!.broadcasterId).toBe('fallback-1');
        expect(result.items[0]!.spots).toBe(22);
        expect(result.items[0]!.totalCost).toBe(75 * 22);
    });
});

// ═══════════════════════════════════════════════════════════════
// buildMediaPlan — over-budget justification
// ═══════════════════════════════════════════════════════════════
describe('buildMediaPlan — over-budget', () => {
    it('deve adicionar nota quando totalCost excede budget', async () => {
        const candidate = createCandidate({ id: 'exp-1', price: 600 });

        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        items: [{
                            broadcasterId: 'exp-1',
                            spots: 22,
                            unitPrice: 600,
                            totalCost: 13200,
                            reasoning: 'Test',
                        }],
                        analysis: 'Plano base.',
                    }),
                },
            }],
        });

        // Budget 10000, but cost will be 600 * 22 = 13200
        const result = await service.buildMediaPlan(createCriteria({ budget: 10000 }), [candidate]);

        expect(result.analysis).toContain('Nota sobre o investimento');
    });
});

// ═══════════════════════════════════════════════════════════════
// buildMediaPlan — erro da AI propaga
// ═══════════════════════════════════════════════════════════════
describe('buildMediaPlan — erros', () => {
    it('deve propagar erro quando AI retorna content vazio', async () => {
        const candidate = createCandidate();

        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: { content: null },
            }],
        });

        await expect(service.buildMediaPlan(createCriteria(), [candidate]))
            .rejects.toThrow('Empty response from AI');
    });

    it('deve propagar erro quando API falha', async () => {
        const candidate = createCandidate();

        mockCreate.mockRejectedValueOnce(new Error('API rate limit'));

        await expect(service.buildMediaPlan(createCriteria(), [candidate]))
            .rejects.toThrow('API rate limit');
    });
});

// ═══════════════════════════════════════════════════════════════
// buildMediaPlan — enrichment de dados
// ═══════════════════════════════════════════════════════════════
describe('buildMediaPlan — enrichment', () => {
    it('deve enriquecer items com dados geo do candidate', async () => {
        const candidate = createCandidate({
            id: 'geo-1',
            latitude: -23.5505,
            longitude: -46.6333,
            antennaClass: 'A',
            logo: 'https://logo.test/img.png',
            dial: '101.3 FM',
        });

        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        items: [{
                            broadcasterId: 'geo-1',
                            spots: 22,
                            unitPrice: 100,
                            totalCost: 2200,
                            reasoning: 'Test',
                        }],
                        analysis: 'Test',
                    }),
                },
            }],
        });

        const result = await service.buildMediaPlan(createCriteria(), [candidate]);

        expect(result.items[0]!.broadcasterLatitude).toBe(-23.5505);
        expect(result.items[0]!.broadcasterLongitude).toBe(-46.6333);
        expect(result.items[0]!.broadcasterAntennaClass).toBe('A');
        expect(result.items[0]!.broadcasterLogo).toBe('https://logo.test/img.png');
        expect(result.items[0]!.broadcasterDial).toBe('101.3 FM');
    });

    it('deve incluir broadcasterProfile com audience e coverage', async () => {
        const candidate = createCandidate({
            id: 'profile-1',
            audience: { male: 60, female: 40 },
            coverage: { radius: 100, cities: 5 },
            pmm: 45000,
            cpm: 2.5,
        });

        mockCreate.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        items: [{
                            broadcasterId: 'profile-1',
                            spots: 22,
                            unitPrice: 100,
                            totalCost: 2200,
                            reasoning: 'Test',
                        }],
                        analysis: 'Test',
                    }),
                },
            }],
        });

        const result = await service.buildMediaPlan(createCriteria(), [candidate]);

        expect(result.items[0]!.broadcasterProfile).toBeDefined();
        expect(result.items[0]!.broadcasterProfile.pmm).toBe(45000);
        expect(result.items[0]!.broadcasterProfile.cpm).toBe(2.5);
    });
});
