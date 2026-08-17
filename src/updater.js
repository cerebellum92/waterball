// Update checker against GitHub Releases API (cerebellum92/waterball)

export const CURRENT_VERSION = 'v0.1.0';
export const REPO_OWNER = 'cerebellum92';
export const REPO_NAME = 'waterball';
export const GITHUB_REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

export class UpdateChecker {
  constructor() {
    this.currentVersion = CURRENT_VERSION;
  }

  /**
   * Check latest release from GitHub API
   * @returns {Promise<{ hasUpdate: boolean, latestVersion: string, currentVersion: string, releaseUrl: string, releaseNotes: string, publishedAt: string }>}
   */
  async checkUpdate() {
    try {
      const resp = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (resp.status === 404) {
        // No release published yet
        return {
          hasUpdate: false,
          latestVersion: this.currentVersion,
          currentVersion: this.currentVersion,
          releaseUrl: `${GITHUB_REPO_URL}/releases`,
          releaseNotes: '目前為最新預覽版本。',
          publishedAt: '',
        };
      }

      if (!resp.ok) {
        throw new Error(`GitHub API 回應錯誤 (${resp.status})`);
      }

      const data = await resp.json();
      const latestTag = data.tag_name || data.name || '';
      const latestVerClean = latestTag.replace(/^v/, '');
      const currentVerClean = this.currentVersion.replace(/^v/, '');

      const hasUpdate = this.compareSemVer(latestVerClean, currentVerClean) > 0;

      return {
        hasUpdate,
        latestVersion: latestTag.startsWith('v') ? latestTag : `v${latestTag}`,
        currentVersion: this.currentVersion,
        releaseUrl: data.html_url || `${GITHUB_REPO_URL}/releases/latest`,
        releaseNotes: data.body || '包含多項效能優化與 Bug 修復。',
        publishedAt: data.published_at ? new Date(data.published_at).toLocaleDateString('zh-TW') : '',
      };
    } catch (err) {
      console.warn('[Updater] Check failed:', err);
      throw err;
    }
  }

  /**
   * Compare two semver strings: a > b -> 1, a < b -> -1, a == b -> 0
   */
  compareSemVer(a, b) {
    const pa = a.split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }
}
