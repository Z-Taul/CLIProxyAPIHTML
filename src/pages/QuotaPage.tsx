/**
 * Quota management page - coordinates the three quota sections.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { authFilesApi, configFileApi } from '@/services/api';
import {
  QuotaSection,
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
} from '@/components/quota';
import type { AuthFileItem } from '@/types';
import styles from './QuotaPage.module.scss';

const QUOTA_SECTION_META = [
  { key: 'claude', label: 'Claude', config: CLAUDE_CONFIG },
  { key: 'antigravity', label: 'Antigravity', config: ANTIGRAVITY_CONFIG },
  { key: 'codex', label: 'Codex', config: CODEX_CONFIG },
  { key: 'gemini-cli', label: 'Gemini CLI', config: GEMINI_CLI_CONFIG },
  { key: 'kimi', label: 'Kimi', config: KIMI_CONFIG },
] as const;

export function QuotaPage() {
  const { t } = useTranslation();
  const tr = (
    key: string,
    defaultValue: string,
    options?: Record<string, unknown>
  ) => t(key, { defaultValue, ...(options ?? {}) });
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';

  const trackedFiles = useMemo(
    () =>
      files.filter((file) =>
        QUOTA_SECTION_META.some((section) => section.config.filterFn(file))
      ),
    [files]
  );
  const sectionSummaries = useMemo(
    () =>
      QUOTA_SECTION_META.map((section) => ({
        key: section.key,
        label: section.label,
        count: files.filter((file) => section.config.filterFn(file)).length,
      })),
    [files]
  );
  const enabledTrackedCount = trackedFiles.filter((file) => !file.disabled).length;
  const disabledTrackedCount = trackedFiles.filter((file) => file.disabled).length;
  const activeSections = sectionSummaries.filter((section) => section.count > 0).length;
  const statusMessage =
    connectionStatus !== 'connected'
      ? tr('quota_management.status_hint_disconnected', '请先连接管理 API，再刷新配额数据。')
      : loading
        ? tr(
            'quota_management.status_hint_loading',
            '认证文件正在加载，列表就绪后即可继续刷新对应配额卡片。'
          )
        : tr(
            'quota_management.status_hint_ready',
            '可以使用分区刷新按钮，或通过顶部全局刷新动作拉取最新配额状态。'
          );

  const loadConfig = useCallback(async () => {
    try {
      await configFileApi.fetchConfigYaml();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError((prev) => prev || errorMessage);
    }
  }, [t]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadConfig(), loadFiles()]);
  }, [loadConfig, loadFiles]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    loadFiles();
    loadConfig();
  }, [loadFiles, loadConfig]);

  return (
    <div className={styles.container}>
      <section className={styles.overviewHero}>
        <div className={styles.pageHeader}>
          <span className={styles.heroEyebrow}>
            {tr('quota_management.overview_title', '配额总览')}
          </span>
          <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
          <p className={styles.description}>{t('quota_management.description')}</p>
        </div>

        <div className={styles.heroStatusPanel}>
          <div className={styles.heroStatusTop}>
            <span className={styles.heroStatusLabel}>
              {tr('quota_management.refresh_hint', '刷新状态')}
            </span>
            <span
              className={`${styles.statusBadge} ${
                disableControls ? styles.statusDanger : styles.statusGood
              }`}
            >
              {disableControls ? t('common.disconnected') : t('common.connected')}
            </span>
          </div>
          <p className={styles.heroStatusText}>{statusMessage}</p>
        </div>
      </section>

      <div className={styles.overviewGrid}>
        <div className={styles.overviewCard}>
          <span className={styles.overviewLabel}>
            {tr('quota_management.tracked_credentials', '已追踪凭证')}
          </span>
          <strong className={styles.overviewValue}>{trackedFiles.length}</strong>
          <span className={styles.overviewHint}>
            {tr(
              'quota_management.credential_mix_desc',
              '下方各配额分区的刷新逻辑保持不变，这里仅做汇总展示，方便先判断重点区域。'
            )}
          </span>
        </div>
        <div className={styles.overviewCard}>
          <span className={styles.overviewLabel}>
            {tr('quota_management.enabled_credentials', '启用凭证')}
          </span>
          <strong className={styles.overviewValue}>{enabledTrackedCount}</strong>
          <span className={styles.overviewHint}>
            {disabledTrackedCount > 0
              ? tr(
                  'dashboard.disabled_credentials_hint',
                  '当前有 {{count}} 个凭证处于禁用状态',
                  {
                    count: disabledTrackedCount,
                  }
                )
              : tr('dashboard.all_credentials_active', '当前追踪的凭证均已启用')}
          </span>
        </div>
        <div className={styles.overviewCard}>
          <span className={styles.overviewLabel}>
            {tr('quota_management.disabled_credentials', '禁用凭证')}
          </span>
          <strong className={styles.overviewValue}>{disabledTrackedCount}</strong>
          <span className={styles.overviewHint}>
            {disabledTrackedCount > 0
              ? tr(
                  'dashboard.disabled_credentials_hint',
                  '当前有 {{count}} 个凭证处于禁用状态',
                  {
                    count: disabledTrackedCount,
                  }
                )
              : tr('dashboard.all_systems_nominal', '最新快照未发现明显风险')}
          </span>
        </div>
        <div className={styles.overviewCard}>
          <span className={styles.overviewLabel}>
            {tr('quota_management.tracked_sections', '追踪分区')}
          </span>
          <strong className={styles.overviewValue}>{activeSections}</strong>
          <span className={styles.overviewHint}>
            {tr('quota_management.credential_mix', '凭证分布')}
          </span>
        </div>
      </div>

      <section className={styles.mixSection}>
        <div className={styles.mixHeader}>
          <div>
            <h2 className={styles.mixTitle}>
              {tr('quota_management.credential_mix', '凭证分布')}
            </h2>
            <p className={styles.mixDescription}>
              {tr(
                'quota_management.credential_mix_desc',
                '下方各配额分区的刷新逻辑保持不变，这里仅做汇总展示，方便先判断重点区域。'
              )}
            </p>
          </div>
        </div>
        <div className={styles.mixGrid}>
          {sectionSummaries.map((section) => (
            <div key={section.key} className={styles.mixCard}>
              <span className={styles.mixLabel}>{section.label}</span>
              <strong className={styles.mixValue}>{section.count}</strong>
            </div>
          ))}
        </div>
      </section>

      {error && <div className={styles.errorBox}>{error}</div>}

      <QuotaSection
        config={CLAUDE_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={ANTIGRAVITY_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={CODEX_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={GEMINI_CLI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
      <QuotaSection
        config={KIMI_CONFIG}
        files={files}
        loading={loading}
        disabled={disableControls}
      />
    </div>
  );
}
