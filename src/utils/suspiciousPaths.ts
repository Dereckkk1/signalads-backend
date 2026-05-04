// ============================================================
// Padroes de paths usados por bots de scanning automatizado.
// Qualquer request que bata um destes regex e tratada como
// tentativa de exploit/recon e bloqueada na primeira tentativa.
// ============================================================
//
// Regras de manutencao:
// - Sempre usar `i` flag (case-insensitive). Bots usam variacoes.
// - Padroes devem matchar o path completo (req.path), incluindo
//   subpaths. Ex: /.env e /qualquer/coisa/.env.
// - NUNCA adicionar regex que possa pegar rota legitima da app.
//   Em duvida, prefira nao adicionar.
//
// Lista construida a partir de logs reais + listas publicas
// de wordlists usadas por scanners (dirbuster, gobuster, nuclei).

export const SUSPICIOUS_PATH_PATTERNS: RegExp[] = [
    // Arquivos de configuracao .env em qualquer profundidade
    // Cobre /.env, /qualquer/coisa/.env, /.env.bak, /.env.dev, /.env.production, etc.
    /(^|\/)\.env(\.|$|\/)/i,

    // WordPress / WooCommerce
    /(^|\/)wp-admin(\/|$)/i,
    /(^|\/)wp-login\.php/i,
    /(^|\/)wp-content(\/|$)/i,
    /(^|\/)wp-includes(\/|$)/i,
    /(^|\/)wordpress(\/|$)/i,
    /(^|\/)xmlrpc\.php/i,
    /(^|\/)wp-config\.php/i,

    // phpMyAdmin / outros painels
    /(^|\/)(phpmyadmin|pma|myadmin|phpadmin|mysqladmin|sqladmin)(\/|$)/i,
    /(^|\/)adminer(\.php)?(\/|$)/i,

    // Diretorios de VCS expostos
    /(^|\/)\.git(\/|$)/i,
    /(^|\/)\.svn(\/|$)/i,
    /(^|\/)\.hg(\/|$)/i,
    /(^|\/)\.bzr(\/|$)/i,

    // Credenciais de cloud / SSH expostas
    /(^|\/)\.aws(\/|$)/i,
    /(^|\/)\.ssh(\/|$)/i,
    /(^|\/)\.docker(\/|$)/i,
    /(^|\/)\.npmrc(\/|$)/i,
    /(^|\/)credentials(\.json|\.yml|\.yaml)?(\/|$)/i,
    /(^|\/)id_rsa(\.pub)?(\/|$)/i,

    // Arquivos PHP de exploit comuns
    /(^|\/)(shell|cmd|webshell|c99|r57|wso|filemanager)\.php/i,
    /(^|\/)(eval|backdoor|hack|exploit)\.php/i,
    /(^|\/)(info|phpinfo|test|debug)\.php/i,

    // Configs e backups expostos
    /(^|\/)\.htaccess/i,
    /(^|\/)\.htpasswd/i,
    /(^|\/)\.DS_Store/i,
    /(^|\/)web\.config/i,
    /\.(bak|backup|old|orig|swp|save|tmp)$/i,
    /\.(sql|sqlite|db|mdb)$/i,
    /\.(zip|tar|tar\.gz|tgz|rar|7z)$/i,

    // composer / package configs
    /(^|\/)composer\.(json|lock|phar)/i,
    /(^|\/)package(-lock)?\.json\.bak/i,

    // CMSes e frameworks especificos sondados por bots
    /(^|\/)(joomla|drupal|magento|prestashop|shopify|laravel|symfony)(\/|$)/i,
    /(^|\/)(typo3|opencart|moodle|kraken|umbraco)(\/|$)/i,

    // Endpoints de actuator / monitoramento (Spring Boot, etc.)
    /(^|\/)actuator(\/|$)/i,
    /(^|\/)server-status/i,
    /(^|\/)server-info/i,
    /(^|\/)jmx-console(\/|$)/i,
    /(^|\/)solr(\/|$)/i,
    /(^|\/)console(\/|$)/i,

    // CGI / scripts antigos
    /(^|\/)cgi-bin(\/|$)/i,
    /(^|\/)scripts(\/|$).*\.(pl|cgi|sh)$/i,

    // Tentativas de path traversal
    /\.\.[\/\\]/,

    // API versionada que NAO existe no sistema (todas as rotas sao /api/<recurso>).
    // Bots sondam /v1/, /v2/, /v3/, /api/v1/, /api/v2/ esperando endpoints REST padrao.
    /^\/v\d+(\/|$)/i,
    /^\/api\/v\d+(\/|$)/i,

    // ASP / coldfusion
    /\.(asp|aspx|cfm|jsp)$/i,
];

// ─────────────────────────────────────────────────────────────
// Verifica se um path bate em qualquer padrao suspeito.
// Retorna o regex que matcheou (para logging) ou null.
// ─────────────────────────────────────────────────────────────
export function matchSuspiciousPath(path: string): RegExp | null {
    for (const pattern of SUSPICIOUS_PATH_PATTERNS) {
        if (pattern.test(path)) return pattern;
    }
    return null;
}
