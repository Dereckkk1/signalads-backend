export const escapeRegex = (str: string): string =>
    str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const toAccentInsensitiveRegex = (text: string): RegExp => {
    // Primeiro normalizamos o texto de entrada para remover quaisquer acentos fornecidos pelo usuário.
    // Isso é crucial para que, se o usuário pesquisar "São Paulo", possamos gerar um regex 
    // que combine tanto com "São Paulo" quanto com "Sao Paulo".
    const normalizedText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Escape special regex characters except we will handle them
    const escapedText = normalizedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const accentMap: { [key: string]: string } = {
        a: '[aáàâãä]',
        e: '[eéèêë]',
        i: '[iíìîï]',
        o: '[oóòôõö]',
        u: '[uúùûü]',
        c: '[cç]',
        n: '[nñ]',
        y: '[yýÿ]'
    };

    const pattern = escapedText
        .split('')
        .map((char) => {
            const lower = char.toLowerCase();
            return accentMap[lower] || char;
        })
        .join('');

    return new RegExp(pattern, 'i');
};
