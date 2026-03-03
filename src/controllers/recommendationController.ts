import { Request, Response } from 'express';
import { AIService, UserCriteria, BroadcasterCandidate } from '../services/AIService';
import { User } from '../models/User';
import { Product } from '../models/Product';

const aiService = new AIService();

export const generatePlan = async (req: Request, res: Response) => {
    try {
        const criteria: UserCriteria = req.body;

        if (!criteria.businessDescription || !criteria.location || !criteria.budget) {
            return res.status(400).json({ error: 'Missing required fields: businessDescription, location, budget' });
        }

        // STAGE 1: Resolving Location
        console.log(`[AI] Resolving location: "${criteria.location}"...`);
        const locationData = await aiService.resolveLocation(criteria.location);
        const cities = locationData.cities;
        const states = locationData.states;

        console.log(`[AI] Resolved to: Cities=[${cities.join(', ')}], States=[${states.join(', ')}]`);

        // STAGE 2: Fetching Candidates from DB
        // Enhanced Location Logic:
        // If "Região" is explicitly requested OR multiple cities resolved, likely a regional search.
        // We search in Address OR Coverage.

        const isRegionalSearch = criteria.location.toLowerCase().includes('regi') || cities.length > 1 || states.length > 0;

        const regexCities = cities.map(c => new RegExp(c, 'i'));
        const regexStates = states.map(s => new RegExp(`^${s}$`, 'i'));

        // Logic to limit coverage matching to the FIRST 5 CITIES only
        // This prevents distant broadcasters from appearing just because they list a city
        // at the end of a long coverage list (e.g. Curitiba showing up for Joinville).
        const coverageQueries = [0, 1, 2, 3, 4].map(index => ({
            [`broadcasterProfile.coverage.cities.${index}`]: { $in: regexCities }
        }));

        const query: any = {
            userType: 'broadcaster',
            status: 'approved',
            $or: [
                // Primary Locations (City OR State)
                { 'address.city': { $in: regexCities } },
                { 'address.state': { $in: regexStates } },
                // Match only top 5 cities in coverage (Secondary Locations)
                ...coverageQueries
            ]
        };

        const broadcasters = await User.find(query).select('name address companyName broadcasterProfile _id').lean();

        if (broadcasters.length === 0) {
            return res.json({
                items: [],
                totalCost: 0,
                totalSpots: 0,
                totalBroadcasters: 0,
                analysis: `Nenhuma emissora encontrada na região: ${criteria.location} (${cities.join(', ')})`
            });
        }

        // Enrich candidates with product pricing (cheapest spot)
        let candidates: BroadcasterCandidate[] = [];

        for (const b of broadcasters) {
            // Priority: Find 30s Commercial (Standard)
            let product = await Product.findOne({
                broadcasterId: b._id,
                isActive: true,
                duration: 30
            }).lean();

            // Fallback: If no 30s spot, find cheapest active product of any duration
            if (!product) {
                product = await Product.findOne({ broadcasterId: b._id, isActive: true })
                    .sort({ pricePerInsertion: 1 }) // cheapest first
                    .limit(1)
                    .lean();
            }

            if (product) {
                // REMOVED STRICT BUDGET FILTER to allow "Strategic Over-Budget" choices
                // The AI will decide if it's worth it.

                candidates.push({
                    id: (b._id as any).toString(),
                    productId: (product._id as any).toString(),
                    name: b.companyName || b.name || 'Unknown Station',
                    city: b.address?.city || '',
                    state: b.address?.state || '',
                    audience: b.broadcasterProfile?.audienceProfile || {},
                    price: product.pricePerInsertion,
                    coverage: b.broadcasterProfile?.coverage || {},
                    segments: b.broadcasterProfile?.categories || [],
                    // Rich data for frontend display & Cart
                    logo: b.broadcasterProfile?.logo || '',
                    dial: b.broadcasterProfile?.generalInfo?.dialFrequency || '',
                    pmm: b.broadcasterProfile?.pmm || 0,
                    ageRange: b.broadcasterProfile?.audienceProfile?.ageRange || '',
                    // Geo data for campaign map
                    latitude: b.address?.latitude || undefined,
                    longitude: b.address?.longitude || undefined,
                    antennaClass: b.broadcasterProfile?.generalInfo?.antennaClass || 'A4'
                });
            }
        }

        // STAGE 2.5: RELEVANCE SCORING & SORTING
        // Move highly relevant stations to the top so the AI sees them first (in case of truncation).
        const targetTags = (criteria.targetAudience || []).map(t => t.toLowerCase());

        candidates = candidates.map(c => {
            let score = 0;
            const aud = c.audience || {};
            const cats = (c.segments || []).map(s => s.toLowerCase());
            const ageRange = (c.ageRange || '').toLowerCase();

            // 1. Social Class Relevance
            if (targetTags.some(t => t.includes('classe a/b'))) {
                score += (aud.socialClass?.classeAB || 0); // Add percentage points directly
            }
            if (targetTags.some(t => t.includes('classe c'))) {
                score += (aud.socialClass?.classeC || 0);
            }
            if (targetTags.some(t => t.includes('classe de'))) {
                score += (aud.socialClass?.classeDE || 0);
            }

            // 2. Age Relevance (Categories + Explicit Age Range)
            if (targetTags.some(t => t.includes('jovem') || t.includes('18-24'))) {
                // Heuristic: Pop/Jovem stations usually have categories OR explicit age range
                if (cats.includes('pop') || cats.includes('jovem') || cats.includes('hits')) score += 50;
                if (ageRange.includes('18') || ageRange.includes('24') || ageRange.includes('jovem')) score += 50;
            }
            if (targetTags.some(t => t.includes('adulto') || t.includes('25-45'))) {
                if (cats.includes('adulto') || cats.includes('contemporâneo')) score += 50;
                if (ageRange.includes('25') || ageRange.includes('30') || ageRange.includes('adulto')) score += 50;
            }
            if (targetTags.some(t => t.includes('senior') || t.includes('45+'))) {
                if (ageRange.includes('45') || ageRange.includes('50') || ageRange.includes('60')) score += 50;
            }

            // 3. Gender Relevance (Implicit via Business Description is hard here, relying on AI for that)
            // But we can boost generally if audience data exists
            if (aud.gender?.male > 60 || aud.gender?.female > 60) score += 10;

            return { ...c, _relevanceScore: score };
        }).sort((a, b) => (b as any)._relevanceScore - (a as any)._relevanceScore); // DESC

        // Calculate Max PMM for Relative Power Context
        const maxPmm = Math.max(...candidates.map(c => c.pmm || 0), 1); // Avoid div by zero

        // Add Market Context to candidates
        const enrichedCandidates = candidates.map(c => ({
            ...c,
            marketContext: {
                isLeader: (c.pmm || 0) === maxPmm,
                relativePower: Math.round(((c.pmm || 0) / maxPmm) * 100), // 0-100 score
                maxPmmInRegion: maxPmm,
                relevanceScore: (c as any)._relevanceScore // Pass score to AI to help it decide
            }
        }));

        console.log(`[AI] Found ${candidates.length} candidates. Leader PMM: ${maxPmm}`);

        // STAGE 3: AI Media Planning
        const plan = await aiService.buildMediaPlan(criteria, enrichedCandidates);

        res.json(plan);

    } catch (error) {
        console.error('[AI] Error generating plan:', error);
        res.status(500).json({ error: 'Failed to generate media plan' });
    }
};
