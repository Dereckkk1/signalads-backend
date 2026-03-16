import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

export interface UserCriteria {
    businessDescription: string;
    location: string;
    objective: string;
    budget: number;
    // New fields
    targetAudience?: string[];
    briefing?: string;
}

export interface BroadcasterCandidate {
    id: string;
    productId: string;
    name: string;
    city: string;
    state: string;
    audience: any;
    price: number;
    coverage: any;
    segments: string[];
    // NEW FIELDS
    logo?: string;
    dial?: string;
    pmm?: number;
    cpm?: number | null; // Cost per 1000 listeners. Lower = more efficient.
    ageRange?: string; // e.g., "86% 25+"
    // GEO FIELDS (for map rendering)
    latitude?: number;
    longitude?: number;
    antennaClass?: string;
}

export interface MediaPlanItem {
    broadcasterId: string;
    productId: string;
    broadcasterName: string;
    spots: number;
    unitPrice: number;
    totalCost: number;
    reasoning: string;
    // NEW FIELDS FOR UI & CART
    broadcasterLogo?: string;
    broadcasterDial?: string;
    broadcasterCity?: string;
    broadcasterState?: string;
    broadcasterProfile?: any;
    // GEO FIELDS (for map rendering)
    broadcasterLatitude?: number;
    broadcasterLongitude?: number;
    broadcasterAntennaClass?: string;
}

export interface MediaPlan {
    items: MediaPlanItem[];
    totalCost: number;
    totalSpots: number;
    totalBroadcasters: number;
    analysis: string;
}

export class AIService {
    private client: OpenAI;

    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }

    /**
     * Resolves a vague location string (e.g., "Norte de SC") into a list of cities/states.
     */
    async resolveLocation(query: string): Promise<{ cities: string[]; states: string[] }> {
        try {
            if (!query || query.length < 3) return { cities: [], states: [] };

            const response = await this.client.chat.completions.create({
                model: 'gpt-5-chat-latest', // Using gpt-5-chat-latest as proxy for high-reasoning model
                messages: [
                    {
                        role: 'system',
                        content: `You are a Brazilian Geography Expert.
            Convert the user's location query into a JSON object with:
            - "cities": List of cities in that region, ORDERED BY PROXIMITY/RELEVANCE.
            - "states": List of relevant states (2-letter codes).
            
            Example: "Vale do Itajaí" -> {"cities": ["Blumenau", "Itajaí", "Brusque"], "states": ["SC"]}
            Example: "São Paulo" -> {"cities": ["São Paulo"], "states": ["SP"]}

            Return ONLY raw JSON.`
                    },
                    { role: 'user', content: query }
                ],
                response_format: { type: 'json_object' }
            });

            const content = response.choices[0]?.message?.content;
            if (!content) return { cities: [], states: [] };

            const result = JSON.parse(content);
            // Limit to top 10 cities to ensure coverage of multiple regions/states
            return {
                cities: (result.cities || []).slice(0, 10),
                states: result.states || []
            };
        } catch {
            // Fallback: simple exact match attempt
            return { cities: [query], states: [] };
        }
    }

    /**
     * Generates a media plan based on candidates and constraints.
     */
    async buildMediaPlan(criteria: UserCriteria, candidates: BroadcasterCandidate[]): Promise<MediaPlan> {
        // If no candidates, return empty plan
        if (!candidates || candidates.length === 0) {
            return { items: [], totalCost: 0, totalSpots: 0, totalBroadcasters: 0, analysis: "No broadcasters found in the target location." };
        }

        // Limit candidates but keep enough to cover multiple cities (increased to 50)
        const topCandidates = candidates.slice(0, 50);

        const prompt = `
      You are an expert Media Planner for Radio Advertising in Brazil.
      Your goal is to build the most EFFICIENT media plan: MINIMIZE CPM (cost per 1,000 listeners) and MAXIMIZE total audience impacts within the budget.
      DO NOT default to "the market leader". Choose the stations that deliver the best CPM efficiency combined with adequate reach.

      CLIENT PROFILE:
      - Business: ${criteria.businessDescription}
      - Briefing: ${criteria.briefing || 'N/A'}
      - Objective: ${criteria.objective}
      - Budget: R$ ${criteria.budget} (HARD TARGET - YOU MUST USE AS MUCH AS POSSIBLE)
      - Target Location: ${criteria.location}
      - Preferred Audience Tags: ${criteria.targetAudience?.join(', ') || 'General'}

      CANDIDATE BROADCASTERS (JSON) - each includes 'marketContext.cpm' (lower = more efficient):
      ${JSON.stringify(topCandidates)}

      ═══════════════════════════════════════════════════════
      STRATEGY: MAXIMIZE TOTAL IMPACTS + GEOGRAPHIC COVERAGE
      ═══════════════════════════════════════════════════════

      **>>> CORE METRIC: TOTAL CAMPAIGN IMPACTS <<<**
      Total Impacts = Σ (spots × PMM) across all selected stations.
      Your mission: MAXIMIZE this number within the budget.

      **CPM CLARIFICATION** (CRITICAL — read carefully):
      - CPM = marketContext.cpm = (pricePerSpot / PMM) × 1000.
      - Lower CPM means MORE impacts per R$ spent — GOOD.
      - ⚠️ WARNING: A station with a LOW PRICE is NOT necessarily good. If that station has tiny PMM (e.g., PMM=500), its CPM may actually be HIGH and the total impacts will be negligible.
      - ⚠️ WARNING: ALWAYS compare CPM values. A station with R$200/spot and PMM=50,000 (CPM=4) is FAR better than a station with R$50/spot and PMM=2,000 (CPM=25).
      - If CPM is null (no audience data), that station is LOW PRIORITY — avoid it unless it is the ONLY option in a region.

      **>>> RULE 0: BUDGET DISTRIBUTION CAP (HARD LIMIT) <<<**
      - **NO SINGLE STATION may receive more than 35% of the total budget** (R$ ${Math.round(criteria.budget * 0.35)}).
      - This ensures the campaign is distributed and does not over-concentrate in one small station.
      - Exception: if only ONE station exists in the entire search area, you may exceed this cap.

      **>>> RULE 1: GEOGRAPHIC COVERAGE (ABSOLUTE TOP PRIORITY) <<<**
      - If the user specifies multiple regions, cities or states (e.g., "SC, RS, SP, MA, MG, PR"), your **PRIMARY MISSION** is to ensure that EVERY requested location is represented by at least one station.
      - **STRATEGIC HUB RULE**: Within each requested state or region, **prioritize major cities/hubs** (e.g., Londrina over a tiny interior village). Prefer stations with HIGH PMM — they have more listeners.
      - **NO TINY STATIONS**: Do not select a station with very low PMM if a station with significantly higher PMM exists in the same region, even if the cheaper one has lower price.
      - **BALANCED DISTRIBUTION**: All regions must reach at least 22 spots before any single region increases further.
      - **REALLOCATION LOGIC**: In case of tight budget, shift investment from already-covered regions to uncovered ones.
      - If it is mathematically impossible to cover all regions, clearly explain in 'analysis'.

      **>>> RULE 2: STATION SELECTION WITHIN EACH REGION <<<**
      For each region, select the station that BEST BALANCES:
        a) **Lowest CPM** (efficiency) — prefer stations where CPM is in the lowest 50% of candidates.
        b) **Highest PMM** (volume) — prefer stations with more listeners, as they generate more impacts per spot.
        c) **Avoid stations with PMM below 10% of the max PMM in the region** — these are too small to contribute meaningfully.

      Selection priority order within a region:
        1. Best CPM AND meaningful PMM (both criteria met) → IDEAL
        2. Best CPM with moderate PMM → ACCEPTABLE
        3. Highest PMM with moderate CPM → ACCEPTABLE if no better CPM option
        4. Low price but tiny PMM → AVOID (false economy)

      **>>> RULE 3: BUDGET FILLING — DISTRIBUTE, DON'T CONCENTRATE <<<**
      - You MUST spend as close to R$ ${criteria.budget} as possible (Target: 95% to 100%). DO NOT EXCEED.
      - After all regions have 44 spots, fill remaining budget by adding 22 spots at a time.
      - **DISTRIBUTE fills across stations** — do not keep adding to one station. Rotate through selected stations.
      - Never allow a single station to exceed 35% of the total budget (R$ ${Math.round(criteria.budget * 0.35)}).
      - Spots must always be multiples of 22. Minimum 22 spots per station.

      **>>> STEP-BY-STEP ALGORITHM <<<**
      1. **COVERAGE PASS**: For EACH requested region, select the best-balanced station (CPM + PMM). Assign 22 spots.
      2. **FREQUENCY PASS**: Scale ALL selected stations to 44 spots before adding more to any single one.
      3. **DISTRIBUTION FILL**: With remaining budget, rotate through all stations adding 22 spots each round (round-robin), prioritizing the station with best CPM in each round, WHILE respecting the 35% budget cap per station.
      4. Repeat step 3 until budget is ≥ 95% used or no more spots can be added without exceeding budget.
      5. **OVERBUDGET FIX**: If a 22-spot block would exceed budget, skip that station and try the next one.

      **>>> IMPORTANT CONSTRAINTS <<<**
      - Do NOT select stations where marketContext.isTinyStation = true, unless they are the ONLY option in that region. Tiny stations waste budget on negligible reach.
      - Do NOT select stations with null CPM unless they are the ONLY option in that region.
      - Minimum frequency to have media impact: 44 spots per station (if budget allows).
      - **HARD CAP**: No station gets more than 35% of total budget (R$ ${Math.round(criteria.budget * 0.35)}).

      **>>> ANALYSIS FIELD <<<**
      - Write as a Senior Media Planner presenting to a client (PT-BR).
      - DO NOT mention "CPM", "marketContext", "relativePower", "pmm", or algorithm internals.
      - DO NOT say "the leader is too expensive". Use strategic, positive language.
      - USE LANGUAGE LIKE:
          - "Priorizamos as emissoras com melhor custo por impacto, garantindo mais audiência com o mesmo investimento."
          - "Priorizamos a cobertura geográfica para abranger todas as praças solicitadas (X, Y e Z)."
          - "A distribuição equilibrada garante presença de marca em todos os mercados-chave."
          - "Selecionamos emissoras com alta eficiência de audiência para maximizar o retorno da campanha."
      - Explain WHY these stations help achieve the client's objective (${criteria.objective}).
      - IF a requested region was left out due to budget: explicitly and professionally justify it.

      OUTPUT FORMAT (JSON):
      {
        "items": [
          {
            "broadcasterId": "string (MUST MATCH candidate.id)",
            "productId": "string (from candidate.productId)",
            "broadcasterName": "string",
            "spots": number (multiple of 22),
            "unitPrice": number,
            "totalCost": number,
            "reasoning": "string (PT-BR - explain the efficiency/coverage reason for this specific station)"
          }
        ],
        "analysis": "string (PT-BR) - A professional, persuasive executive summary."
      }
    `;

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-5-chat-latest',
                messages: [
                    { role: 'system', content: 'You are a strategic Media Planner. Your primary goal is to MINIMIZE CPM and MAXIMIZE audience impacts. Always cover all requested geographic regions first, then optimize for CPM efficiency.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            });

            const content = response.choices[0]?.message?.content;
            if (!content) throw new Error('Empty response from AI');

            const planData = JSON.parse(content);
            const rawItems = planData.items || [];

            // RE-ENRICH ITEMS & FORCE CORRECT MATH
            const seenIds = new Set<string>();

            let items = rawItems.map((item: any) => {
                // Deduplication check
                if (seenIds.has(item.broadcasterId)) return null;

                const candidate = candidates.find(c => c.id === item.broadcasterId);

                // Anti-Hallucination Guard
                if (!candidate) {
                    return null;
                }

                seenIds.add(item.broadcasterId);

                // FORCE Database Pricing & Spot Logic
                const realPrice = candidate.price;
                // Ensure spots is at least 22 and a multiple of 22
                const rawSpots = item.spots || 22;
                const safeSpots = Math.max(22, Math.ceil(rawSpots / 22) * 22);
                const realTotalCost = safeSpots * realPrice;

                return {
                    broadcasterId: candidate.id, // Ensure correct ID
                    productId: candidate.productId, // Use candidate's productId
                    broadcasterName: candidate.name, // Ensure correct Name
                    spots: safeSpots, // Forced multiple of 22
                    unitPrice: realPrice, // Real DB Price
                    totalCost: realTotalCost, // Real Math
                    reasoning: item.reasoning, // Keep AI's reasoning

                    broadcasterLogo: candidate.logo,
                    broadcasterDial: candidate.dial,
                    broadcasterCity: candidate.city,
                    broadcasterState: candidate.state,
                    broadcasterProfile: {
                        audienceProfile: candidate.audience,
                        coverage: candidate.coverage,
                        pmm: candidate.pmm,
                        cpm: candidate.cpm,
                        logo: candidate.logo
                    },
                    broadcasterLatitude: candidate.latitude,
                    broadcasterLongitude: candidate.longitude,
                    broadcasterAntennaClass: candidate.antennaClass
                };
            }).filter((item: any) => item !== null);

            // PROGRAMMATIC BUDGET FILLING LOOP
            // After AI response, maximize budget usage by increasing spots on existing items
            let totalCost = items.reduce((sum: number, item: any) => sum + item.totalCost, 0);
            let remainingBudget = criteria.budget - totalCost;

            if (remainingBudget > 0 && items.length > 0) {
                // Hard cap: no single station may receive more than 35% of total budget
                const perStationCap = criteria.budget * 0.35;

                // Sort items by CPM ASC (lowest = most impacts per R$), fallback to PMM DESC
                const sortedByImpact = [...items].sort((a: any, b: any) => {
                    const aCpm = a.broadcasterProfile?.cpm ?? null;
                    const bCpm = b.broadcasterProfile?.cpm ?? null;
                    if (aCpm !== null && bCpm !== null) return aCpm - bCpm;
                    if (aCpm === null && bCpm !== null) return 1;
                    if (aCpm !== null && bCpm === null) return -1;
                    return (b.broadcasterProfile?.pmm || 0) - (a.broadcasterProfile?.pmm || 0);
                });

                // Round-robin fill: one pass adds at most 22 spots per station per round.
                // This distributes budget across stations instead of concentrating on one.
                let fillingDone = false;
                while (!fillingDone) {
                    fillingDone = true;
                    for (const highImpactItem of sortedByImpact) {
                        const costFor22 = highImpactItem.unitPrice * 22;
                        if (costFor22 > remainingBudget) continue;

                        const originalItem = items.find((i: any) => i.broadcasterId === highImpactItem.broadcasterId);
                        if (!originalItem) continue;

                        // Enforce per-station budget cap
                        if (originalItem.totalCost + costFor22 > perStationCap) continue;

                        originalItem.spots += 22;
                        originalItem.totalCost = originalItem.spots * originalItem.unitPrice;
                        remainingBudget -= costFor22;
                        fillingDone = false;
                    }
                }

                totalCost = items.reduce((sum: number, item: any) => sum + item.totalCost, 0);
            }

            // OVER-BUDGET JUSTIFICATION
            // If the plan exceeds the budget, append a professional justification to the analysis
            let analysis = planData.analysis || 'Plano de mídia gerado com base em inteligência de dados.';
            if (totalCost > criteria.budget) {
                const excessPercentage = (((totalCost - criteria.budget) / criteria.budget) * 100).toFixed(1);
                const excessValue = (totalCost - criteria.budget).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                analysis += `\n\n⚠️ Nota sobre o investimento: O valor total ultrapassa a verba definida em ${excessPercentage}% (R$ ${excessValue}). Isso se deve à estrutura de pacotes das emissoras selecionadas (blocos de 22 inserções), onde o plano mínimo viável para garantir frequência e impacto adequados exige este investimento.`;
            }

            // Emergency Fallback: If AI returns nothing (e.g. extremely confused), pick top relevance candidate?
            if (items.length === 0 && topCandidates.length > 0) {
                const bestFit = topCandidates[0]; // Already sorted by relevance in Controller!
                if (bestFit) {
                    items.push({
                        broadcasterId: bestFit.id,
                        productId: bestFit.productId,
                        broadcasterName: bestFit.name,
                        spots: 22,
                        unitPrice: bestFit.price,
                        totalCost: bestFit.price * 22,
                        reasoning: "Seleção automática baseada em relevância demográfica.",
                        broadcasterLogo: bestFit.logo,
                        broadcasterDial: bestFit.dial,
                        broadcasterCity: bestFit.city,
                        broadcasterState: bestFit.state,
                        broadcasterProfile: {
                            audienceProfile: bestFit.audience,
                            coverage: bestFit.coverage,
                            pmm: bestFit.pmm,
                            logo: bestFit.logo
                        },
                        broadcasterLatitude: bestFit.latitude,
                        broadcasterLongitude: bestFit.longitude,
                        broadcasterAntennaClass: bestFit.antennaClass
                    });
                    totalCost = bestFit.price * 22;
                }
            }

            const totalSpots = items.reduce((sum: number, item: any) => sum + item.spots, 0);

            return {
                items,
                totalCost,
                totalSpots,
                totalBroadcasters: items.length,
                analysis
            };

        } catch (error) {
            throw error;
        }
    }
}
