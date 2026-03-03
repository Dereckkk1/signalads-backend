import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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
        } catch (error) {
            console.error('Error in resolveLocation:', error);
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
      Your goal is to create a "Leader + Complementary" strategic plan.

      CLIENT PROFILE:
      - Business: ${criteria.businessDescription}
      - Briefing: ${criteria.briefing || 'N/A'}
      - Objective: ${criteria.objective}
      - Budget: R$ ${criteria.budget} (HARD TARGET - YOU MUST USE AS MUCH AS POSSIBLE)
      - Target Location: ${criteria.location}
      - Preferred Audience Tags: ${criteria.targetAudience?.join(', ') || 'General'}

      CANDIDATE BROADCASTERS (JSON) - sorted candidates with 'marketContext':
      ${JSON.stringify(topCandidates)}
      
      STRATEGY INSTRUCTIONS (The "Leader + Niche" Method):

      **>>> RULE 1: GEOGRAPHIC COVERAGE & FAIRNESS (ABSOLUTE TOP PRIORITY) <<<** 
      - If the user specifies multiple regions, cities or states (e.g., "SC, RS, SP, MA, MG, PR"), your **PRIMARY MISSION** is to ensure that EVERY requested location is covered by at least one broadcaster.
      - **BALANCED VERTICAL SCALING**: Do not increase one station to 66 or 88 spots if another requested region only has 22 spots. Everyone MUST reach 44 spots (Standard Frequency) before any single station is allowed to go higher.
      - **STRATEGIC HUB RULE**: Within each requested state or region, **prioritize major cities/hubs** (e.g., Londrina instead of a tiny interior village).
      - **NO TINY CITIES**: Do not waste budget on tiny, low-impact cities if a candidate from a larger city (Hub) in that same region is available.
      - **DISTRIBUTION logic**: 
          1. First, select ONE Leader for EACH location (min 22 spots).
          2. Scale ALL Leaders to 44 spots (if budget allows).
          3. Only AFTER all locations have a Leader with 44 spots, you may increase frequency further OR add complementary stations.
      - **REALLOCATION LOGIC**: In case of tight budget, shift investment from already covered cities to the uncovered ones.
      - If even after cuts it is mathematically impossible to cover all regions (due to very low budget), you must clearly explain this in the 'analysis' field.

      **>>> RULE 2: BUDGET MAXIMIZATION (SECONDARY PRIORITY) <<<**
      - You MUST spend as close to R$ ${criteria.budget} as possible (Target: 95% to 100%).
      - Follow Rule 1 first, then fill the budget.
      - The budget was set by the client. Leaving money on the table is UNACCEPTABLE.

      1. **GEOGRAPHIC PROXIMITY**: If you select a station NOT physically located in '${criteria.location}', ensure it is from a **Neighboring City (Max 20km)**.
         - STRICTLY EXCLUDE stations from far away cities (>20km) unless they are famous state-wide giants.
         - Priority is always for local stations.

      2. **LEADER & BUDGET STRATEGY (CRITICAL)**:
         - Identify the "Market Leader" ("marketContext.isLeader": true).
         - Calculate 'LeaderBaseCost = UnitPrice * 22'.
         
         - **SCENARIO 1: LEADER IS AFFORDABLE (< 60% of Budget)**:
             - **Ideal Plan**: Select Leader (High Freq) + 2-3 Complementary Stations.
             - **INCREASE SPOTS** on all stations until the budget is filled.
         
         - **SCENARIO 2: LEADER IS EXPENSIVE (60% - 100% of Budget)**:
             - **Solo Plan**: Select **ONLY** the Leader.
             - Maximize spots on the Leader (e.g., 44, 66, 88, 110) to USE THE FULL BUDGET.
             - **DO NOT** add cheap stations just to add count. Quality over Quantity.
         
         - **SCENARIO 3: LEADER IS UNAFFORDABLE (> Budget)**:
             - **Skip Leader**: It is mathematically impossible.
             - **Alternative Plan**: Select 3-4 best "Complementary" stations that fit the budget together.
             - **MAXIMIZE SPOTS** on all selected stations to fill the budget.
       
      3. **ADD COMPLEMENTARY STATIONS (FREQUENCY > FRAGMENTATION)**:
         - **CONSOLIDATION RULE**: It is better to have **1 strong complementary station with 44 spots** than 2 weak ones with 22 spots each.
         - **Exception**: Rule 0 (Geographic Coverage) takes precedence. Only consolidate if all regions are already covered.
         - **Execution**:
             - If you have budget for 2 complementary stations (22 spots each), check if it's better to give 44 spots to the *Best* one instead.
             - Only split the budget into multiple complementary stations if you can afford decent frequency (at least 22-44 spots) on ALL of them.
         - **Growth**: If budget is large, THEN expand to 3 or 4 stations, but ensure they all have good impact.
       
      4. **BUDGET FILLING ALGORITHM (STAY WITHIN GEOGRAPHIC MANDATE)**:
         - **Target**: Reach as close to R$ ${criteria.budget} as possible (Min 95%, IDEALLY 98-100%). DO NOT EXCEED.
         - **Golden Rule**: **Consolidate Budget** ONLY AFTER all requested regions have at least one station.
         
         - **Filling Logic (Step-by-Step)**:
             1. **Start**: Ensure 22 spots in each requested region.
             2. **Step up**: Increase Leader to 44 spots.
             3. **Add 1st Complementary**: @ 44 spots. (If budget allows).
             4. **Budget Check**:
                 - **IF UNDERBUDGET**: Increase **LEADER** to 66, 88, 110, or even higher.
                 - **IF STILL UNDERBUDGET**: Increase **1st COMPLEMENTARY** to 66, 88 spots.
                 - **ONLY THEN**: Add a **2nd Complementary** station (starting at 44 spots).
                 - **KEEP INCREASING** spots until budget is ≥ 95% used.
                 - **IF OVERBUDGET**:
                     - Reduce spots on the last added station by 22.
                     - If still over, remove that station.
         
         - **Constraint**: **NEVER** add a 2nd Complementary station if the 1st one has only 22 spots. Consolidate them!
         - **FINAL CHECK (The Mental Checklist)**: 
             - Were all requested regions occupied? 
             - If no, was it budget-related or allocation-related? 
             - If it was allocation, shift budget from high-frequency stations in other cities to ensure the missing region is covered.
             - If budget is truly insufficient, explain clearly in the analysis.

      5. **ANALYSIS (IMPORTANT)**:
         - Write the specific \`analysis\` field as if you are a Senior Media Planner presenting to a client.
         - **DO NOT** mention internal variables like "relativePower", "pmm", "Scenario 1", "Scenario 2", or "mathematically impossible".
         - **DO NOT** mention "budget filling algorithm" or "consolidation rule".
         - **DO NOT** explicitly state "The leader is too expensive so we chose..." in a negative way.
         - **INSTEAD, USE STRATEGIC LANGUAGE**:
             - "Optamos por focar na emissora X para garantir autoridade máxima..."
             - "Priorizamos a cobertura geográfica para abranger todas as praças solicitadas (X, Y e Z), garantindo que sua marca esteja presente em cada mercado-chave."
             - "A estratégia de concentração permite dominar a audiência..."
             - "Selecionamos emissoras complementares para ampliar o alcance em nichos específicos..."
         - Explain **WHY** these specific stations help the client achieve their objective (${criteria.objective}).
         - **IF the total cost exceeds the budget**: Include a brief, professional justification.
         - **IF a requested region was left out due to budget**: Explicitly justify why and which region was skipped.


      OUTPUT FORMAT (JSON):
      {
        "items": [
          {
            "broadcasterId": "string (MUST MATCH candidate.id)",
            "productId": "string (from candidate.productId)",
            "broadcasterName": "string",
            "spots": number (Multiple of 22),
            "unitPrice": number,
            "totalCost": number,
            "reasoning": "string (PT-BR - persuasive reason for this specific choice, e.g. 'Líder absoluta no segmento Jovem, ideal para conversão.')"
          }
        ],
        "analysis": "string (PT-BR) - A professional, persuasive executive summary of the plan."
      }
    `;

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-5-chat-latest',
                messages: [
                    { role: 'system', content: 'You are a strategic Media Planner. Prioritize Budget over Audience Fit if necessary.' },
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
                    console.warn(`[AI] Skipped hallucinated item with ID: ${item.broadcasterId}`);
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
                // Sort items by PMM DESC (Impact First) to ensure we increase spots on the most important stations
                const sortedByImpact = [...items].sort((a: any, b: any) => (b.broadcasterProfile?.pmm || 0) - (a.broadcasterProfile?.pmm || 0));

                let fillingDone = false;
                while (!fillingDone) {
                    fillingDone = true; // Assume done unless we add spots
                    for (const highImpactItem of sortedByImpact) {
                        const costFor22 = highImpactItem.unitPrice * 22;
                        if (costFor22 <= remainingBudget) {
                            // Find the item in the original array and increase spots
                            const originalItem = items.find((i: any) => i.broadcasterId === highImpactItem.broadcasterId);
                            if (originalItem) {
                                originalItem.spots += 22;
                                originalItem.totalCost = originalItem.spots * originalItem.unitPrice;
                                remainingBudget -= costFor22;
                                fillingDone = false; // We added spots, keep going to be fair
                            }
                        }
                    }
                }

                // Recalculate total cost after filling
                totalCost = items.reduce((sum: number, item: any) => sum + item.totalCost, 0);
                console.log(`[AI] Budget Filling: Used R$ ${totalCost} of R$ ${criteria.budget} (${((totalCost / criteria.budget) * 100).toFixed(1)}%)`);
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
            console.error('Error in buildMediaPlan:', error);
            throw error;
        }
    }
}
