export const toAccentInsensitiveRegex = (text: string): RegExp => {
    // Escape special regex characters except we will handle them
    const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
