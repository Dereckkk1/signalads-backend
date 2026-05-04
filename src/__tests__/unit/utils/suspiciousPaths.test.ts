/**
 * Unit tests — suspiciousPaths
 * Cobre: matchSuspiciousPath para os principais padroes de exploit/recon.
 */

import { matchSuspiciousPath } from '../../../utils/suspiciousPaths';

describe('matchSuspiciousPath — paths .env', () => {
  const envPaths = [
    '/.env',
    '/.env.bak',
    '/.env.dev',
    '/.env.production',
    '/.env.local',
    '/storage/.env',
    '/api/v1/.env',
    '/laravel/.env',
    '/wordpress/.env',
    '/core/Database/.env',
    '/core/app/.env',
    '/public_html/.env',
    '/dist/.env',
    '/build/.env',
  ];

  envPaths.forEach((path) => {
    it(`bloqueia ${path}`, () => {
      expect(matchSuspiciousPath(path)).not.toBeNull();
    });
  });
});

describe('matchSuspiciousPath — wordpress/cms', () => {
  const cmsPaths = [
    '/wp-admin',
    '/wp-admin/setup-config.php',
    '/wp-login.php',
    '/wp-content/uploads/foo.php',
    '/wp-includes/foo',
    '/wordpress/',
    '/xmlrpc.php',
    '/wp-config.php',
    '/joomla/administrator',
    '/drupal/user/login',
    '/magento/admin',
    '/prestashop/admin',
  ];

  cmsPaths.forEach((path) => {
    it(`bloqueia ${path}`, () => {
      expect(matchSuspiciousPath(path)).not.toBeNull();
    });
  });
});

describe('matchSuspiciousPath — phpMyAdmin/painels', () => {
  const adminPaths = [
    '/phpmyadmin',
    '/phpMyAdmin/',
    '/pma/',
    '/myadmin/',
    '/adminer.php',
    '/sqladmin/',
  ];

  adminPaths.forEach((path) => {
    it(`bloqueia ${path}`, () => {
      expect(matchSuspiciousPath(path)).not.toBeNull();
    });
  });
});

describe('matchSuspiciousPath — VCS expostos', () => {
  const vcsPaths = ['/.git/config', '/.svn/entries', '/.hg/store', '/.git/HEAD'];

  vcsPaths.forEach((path) => {
    it(`bloqueia ${path}`, () => {
      expect(matchSuspiciousPath(path)).not.toBeNull();
    });
  });
});

describe('matchSuspiciousPath — credenciais expostas', () => {
  const credPaths = [
    '/.aws/credentials',
    '/.ssh/id_rsa',
    '/.docker/config.json',
    '/credentials.json',
    '/id_rsa',
  ];

  credPaths.forEach((path) => {
    it(`bloqueia ${path}`, () => {
      expect(matchSuspiciousPath(path)).not.toBeNull();
    });
  });
});

describe('matchSuspiciousPath — shells/exploit php', () => {
  const shellPaths = [
    '/shell.php',
    '/cmd.php',
    '/c99.php',
    '/r57.php',
    '/wso.php',
    '/phpinfo.php',
    '/info.php',
  ];

  shellPaths.forEach((path) => {
    it(`bloqueia ${path}`, () => {
      expect(matchSuspiciousPath(path)).not.toBeNull();
    });
  });
});

describe('matchSuspiciousPath — backups e configs', () => {
  const backupPaths = [
    '/.htaccess',
    '/.htpasswd',
    '/.DS_Store',
    '/web.config',
    '/database.sql',
    '/backup.zip',
    '/site.tar.gz',
    '/old.bak',
  ];

  backupPaths.forEach((path) => {
    it(`bloqueia ${path}`, () => {
      expect(matchSuspiciousPath(path)).not.toBeNull();
    });
  });
});

describe('matchSuspiciousPath — actuator/server status', () => {
  const monPaths = [
    '/actuator/health',
    '/server-status',
    '/server-info',
    '/jmx-console/',
    '/solr/admin',
  ];

  monPaths.forEach((path) => {
    it(`bloqueia ${path}`, () => {
      expect(matchSuspiciousPath(path)).not.toBeNull();
    });
  });
});

describe('matchSuspiciousPath — API versionada inexistente', () => {
  const versionedPaths = [
    '/v1',
    '/v2',
    '/v3',
    '/v10',
    '/v1/',
    '/v2/users',
    '/v3/auth/login',
    '/api/v1',
    '/api/v2',
    '/api/v3/',
    '/api/v1/users',
    '/api/v2/products',
  ];

  versionedPaths.forEach((path) => {
    it(`bloqueia ${path}`, () => {
      expect(matchSuspiciousPath(path)).not.toBeNull();
    });
  });
});

describe('matchSuspiciousPath — path traversal', () => {
  const traversalPaths = ['/../etc/passwd', '/api/foo/../../../secret'];

  traversalPaths.forEach((path) => {
    it(`bloqueia ${path}`, () => {
      expect(matchSuspiciousPath(path)).not.toBeNull();
    });
  });
});

describe('matchSuspiciousPath — case insensitive', () => {
  it('bloqueia .ENV maiusculo', () => {
    expect(matchSuspiciousPath('/.ENV')).not.toBeNull();
  });

  it('bloqueia WP-Admin com case mixto', () => {
    expect(matchSuspiciousPath('/WP-Admin/')).not.toBeNull();
  });

  it('bloqueia PhpMyAdmin', () => {
    expect(matchSuspiciousPath('/PhpMyAdmin/')).not.toBeNull();
  });
});

describe('matchSuspiciousPath — paths legitimos passam', () => {
  const safePaths = [
    '/',
    '/api/auth/login',
    '/api/auth/me',
    '/api/products',
    '/api/products/my-products',
    '/api/cart',
    '/api/admin/broadcasters/pending',
    '/api/admin/users',
    '/api/admin/monitoring/overview',
    '/api/admin/monitoring/blocked-ips',
    '/api/auth/2fa/enable',
    '/api/health',
    '/api/blocked-domains/check',
    '/api/broadcaster/sub-users',
    '/api/sponsorships',
    '/api/insertion-time-slots',
    '/api/kanban/columns',
    '/api/broadcaster-combos',
    '/api/proposals/abc123',
    '/api/campaigns/orderId/approve-broadcaster',
    '/api/auth/confirm-email/some-token',
    '/api/auth/reset-password/some-token',
  ];

  safePaths.forEach((path) => {
    it(`permite ${path}`, () => {
      expect(matchSuspiciousPath(path)).toBeNull();
    });
  });
});
