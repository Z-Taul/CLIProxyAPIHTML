import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconBot,
  IconChartLine,
  IconDiamond,
  IconFileText,
  IconKey,
  IconLayoutDashboard,
  IconSatellite,
  IconScrollText,
  IconSettings,
} from '@/components/ui/icons';
import { useProviderRecentRequests } from '@/components/providers';
import { apiKeysApi, authFilesApi, providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useModelsStore } from '@/stores';
import {
  mergeRecentRequestBucketGroups,
  sumRecentRequests,
  type RecentRequestBucket,
} from '@/utils/recentRequests';
import styles from './DashboardPage.module.scss';

interface QuickStat {
  label: string;
  value: number | string;
  description: string;
  icon: ReactNode;
  path: string;
  loading?: boolean;
}

interface DashboardStats {
  apiKeys: number | null;
  authFiles: number | null;
  disabledAuthFiles: number | null;
}

interface ProviderStats {
  gemini: number | null;
  codex: number | null;
  claude: number | null;
  vertex: number | null;
  openai: number | null;
}

interface ProviderUsageSummary {
  key: string;
  label: string;
  path: string;
  total: number;
  success: number;
  failure: number;
  successRate: number;
  buckets: RecentRequestBucket[];
  configuredCount: number;
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
type InsightTone = 'good' | 'warning' | 'danger';

const PROVIDER_META: Record<string, { label: string; path: string }> = {
  gemini: { label: 'Gemini', path: '/ai-providers' },
  codex: { label: 'Codex', path: '/ai-providers' },
  claude: { label: 'Claude', path: '/ai-providers' },
  vertex: { label: 'Vertex', path: '/ai-providers' },
  openai: { label: 'OpenAI', path: '/ai-providers' },
};

const PROVIDER_ORDER = ['gemini', 'codex', 'claude', 'vertex', 'openai'];

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function formatInteger(value: number, language: string) {
  return new Intl.NumberFormat(language).format(value);
}

function formatPercent(value: number, language: string) {
  return new Intl.NumberFormat(language, {
    maximumFractionDigits: value >= 100 || value === 0 ? 0 : 1,
  }).format(value);
}

function safeDateLabel(value: string | null | undefined, language: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toLocaleDateString(language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function capitalizeFallback(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const tr = useCallback(
    (key: string, defaultValue: string, options?: Record<string, unknown>) =>
      t(key, { defaultValue, ...(options ?? {}) }),
    [t]
  );
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const { usageByProvider, loadRecentRequests, isLoading: usageLoading } =
    useProviderRecentRequests({
      enabled: connectionStatus === 'connected',
    });

  const [stats, setStats] = useState<DashboardStats>({
    apiKeys: null,
    authFiles: null,
    disabledAuthFiles: null,
  });
  const [providerStats, setProviderStats] = useState<ProviderStats>({
    gemini: null,
    codex: null,
    claude: null,
    vertex: null,
    openai: null,
  });
  const [loading, setLoading] = useState(true);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(getTimeOfDay);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  const apiKeysCache = useRef<string[]>([]);

  useEffect(() => {
    apiKeysCache.current = [];
  }, [apiBase, config?.apiKeys]);

  useEffect(() => {
    const id = setInterval(() => {
      setTimeOfDay(getTimeOfDay());
      setCurrentTime(new Date());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const normalizeApiKeyList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];

    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const record =
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const value =
        typeof item === 'string'
          ? item
          : record
            ? record['api-key'] ?? record['apiKey'] ?? record.key ?? record.Key
            : '';
      const trimmed = String(value ?? '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      keys.push(trimmed);
    });

    return keys;
  };

  const resolveApiKeysForModels = useCallback(async () => {
    if (apiKeysCache.current.length) {
      return apiKeysCache.current;
    }

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    try {
      const list = await apiKeysApi.list();
      const normalized = normalizeApiKeyList(list);
      if (normalized.length) {
        apiKeysCache.current = normalized;
      }
      return normalized;
    } catch {
      return [];
    }
  }, [config?.apiKeys]);

  const fetchModels = useCallback(async () => {
    if (connectionStatus !== 'connected' || !apiBase) {
      return;
    }

    try {
      const apiKeys = await resolveApiKeysForModels();
      await fetchModelsFromStore(apiBase, apiKeys[0]);
    } catch {
      // Ignore model fetch errors on the dashboard.
    }
  }, [apiBase, connectionStatus, fetchModelsFromStore, resolveApiKeysForModels]);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const [
          keysRes,
          filesRes,
          geminiRes,
          codexRes,
          claudeRes,
          vertexRes,
          openaiRes,
        ] = await Promise.allSettled([
          apiKeysApi.list(),
          authFilesApi.list(),
          providersApi.getGeminiKeys(),
          providersApi.getCodexConfigs(),
          providersApi.getClaudeConfigs(),
          providersApi.getVertexConfigs(),
          providersApi.getOpenAIProviders(),
        ]);

        const authFiles = filesRes.status === 'fulfilled' ? filesRes.value.files : [];
        const disabledAuthFiles = authFiles.filter((file) => file.disabled).length;

        setStats({
          apiKeys: keysRes.status === 'fulfilled' ? keysRes.value.length : null,
          authFiles: filesRes.status === 'fulfilled' ? authFiles.length : null,
          disabledAuthFiles:
            filesRes.status === 'fulfilled' ? disabledAuthFiles : null,
        });

        setProviderStats({
          gemini: geminiRes.status === 'fulfilled' ? geminiRes.value.length : null,
          codex: codexRes.status === 'fulfilled' ? codexRes.value.length : null,
          claude: claudeRes.status === 'fulfilled' ? claudeRes.value.length : null,
          vertex: vertexRes.status === 'fulfilled' ? vertexRes.value.length : null,
          openai: openaiRes.status === 'fulfilled' ? openaiRes.value.length : null,
        });
      } finally {
        setLoading(false);
      }
    };

    if (connectionStatus === 'connected') {
      void Promise.all([fetchStats(), fetchModels(), loadRecentRequests()]).catch(() => {});
      return;
    }

    setLoading(false);
  }, [connectionStatus, fetchModels, loadRecentRequests]);

  const providerUsage = useMemo<ProviderUsageSummary[]>(() => {
    const configuredCounts: Record<string, number> = {
      gemini: providerStats.gemini ?? 0,
      codex: providerStats.codex ?? 0,
      claude: providerStats.claude ?? 0,
      vertex: providerStats.vertex ?? 0,
      openai: providerStats.openai ?? 0,
    };

    const providerKeys = new Set<string>([
      ...PROVIDER_ORDER,
      ...Array.from(usageByProvider.keys()),
    ]);

    return Array.from(providerKeys)
      .map((providerKey) => {
        const entries = usageByProvider.get(providerKey);
        const usageEntries = entries ? Array.from(entries.values()) : [];
        const total = usageEntries.reduce(
          (sum, entry) => sum + entry.success + entry.failed,
          0
        );
        const success = usageEntries.reduce((sum, entry) => sum + entry.success, 0);
        const failure = usageEntries.reduce((sum, entry) => sum + entry.failed, 0);
        const buckets = mergeRecentRequestBucketGroups(
          usageEntries.map((entry) => entry.recentRequests)
        );
        const meta = PROVIDER_META[providerKey];

        return {
          key: providerKey,
          label: meta?.label ?? capitalizeFallback(providerKey),
          path: meta?.path ?? '/ai-providers',
          total,
          success,
          failure,
          successRate: total > 0 ? (success / total) * 100 : 100,
          buckets,
          configuredCount: configuredCounts[providerKey] ?? 0,
        };
      })
      .filter((item) => item.total > 0 || item.configuredCount > 0)
      .sort((left, right) => {
        if (right.total !== left.total) return right.total - left.total;
        if (right.configuredCount !== left.configuredCount) {
          return right.configuredCount - left.configuredCount;
        }
        return PROVIDER_ORDER.indexOf(left.key) - PROVIDER_ORDER.indexOf(right.key);
      });
  }, [providerStats, usageByProvider]);

  const overallBuckets = useMemo(
    () => mergeRecentRequestBucketGroups(providerUsage.map((item) => item.buckets)),
    [providerUsage]
  );
  const recentTotals = useMemo(() => sumRecentRequests(overallBuckets), [overallBuckets]);
  const totalRecentRequests = recentTotals.success + recentTotals.failure;
  const recentSuccessRate =
    totalRecentRequests > 0
      ? (recentTotals.success / totalRecentRequests) * 100
      : 100;

  const providerConfigsReady = Object.values(providerStats).every(
    (value) => value !== null
  );
  const configuredProviderFamilies = Object.values(providerStats).filter(
    (value) => (value ?? 0) > 0
  ).length;
  const totalProviderConfigs = providerConfigsReady
    ? Object.values(providerStats).reduce((sum, value) => sum + (value ?? 0), 0)
    : 0;
  const enabledCredentials =
    stats.authFiles !== null && stats.disabledAuthFiles !== null
      ? Math.max(0, stats.authFiles - stats.disabledAuthFiles)
      : null;
  const topProvider = providerUsage[0] ?? null;
  const recentWindowMinutes = overallBuckets.length * 10;
  const peakBucketTotal = Math.max(
    1,
    ...overallBuckets.map((bucket) => bucket.success + bucket.failed)
  );

  const quickStats = useMemo<QuickStat[]>(
    () => [
      {
        label: t('dashboard.management_keys'),
        value: stats.apiKeys ?? '-',
        description: t('nav.config_management'),
        icon: <IconKey size={22} />,
        path: '/config',
        loading: loading && stats.apiKeys === null,
      },
      {
        label: t('nav.ai_providers'),
        value: providerConfigsReady ? totalProviderConfigs : '-',
        description: providerConfigsReady
          ? tr('dashboard.provider_family_count', '已配置 {{count}} 类提供商', {
              count: configuredProviderFamilies,
            })
          : tr('dashboard.config_loading', '正在加载配置...'),
        icon: <IconBot size={22} />,
        path: '/ai-providers',
        loading: loading && !providerConfigsReady,
      },
      {
        label: t('nav.auth_files'),
        value: stats.authFiles ?? '-',
        description:
          stats.disabledAuthFiles && stats.disabledAuthFiles > 0
            ? tr(
                'dashboard.disabled_credentials_hint',
                '当前有 {{count}} 个凭证处于禁用状态',
                {
                  count: stats.disabledAuthFiles,
                }
              )
            : tr('dashboard.all_credentials_active', '当前追踪的凭证均已启用'),
        icon: <IconFileText size={22} />,
        path: '/auth-files',
        loading: loading && stats.authFiles === null,
      },
      {
        label: t('dashboard.available_models'),
        value: modelsLoading ? '-' : models.length,
        description: t('dashboard.available_models_desc'),
        icon: <IconSatellite size={22} />,
        path: '/system',
        loading: modelsLoading,
      },
      {
        label: tr('dashboard.recent_requests', '最近请求'),
        value:
          loading || usageLoading
            ? '-'
            : formatInteger(totalRecentRequests, i18n.language),
        description:
          totalRecentRequests > 0
            ? tr('dashboard.request_window', '最近 {{count}} 分钟', {
                count: recentWindowMinutes,
              })
            : tr('dashboard.no_recent_activity', '暂时还没有最近请求活动'),
        icon: <IconChartLine size={22} />,
        path: '/ai-providers',
        loading: usageLoading && totalRecentRequests === 0,
      },
      {
        label: tr('dashboard.success_rate', '成功率'),
        value:
          loading || usageLoading
            ? '-'
            : `${formatPercent(recentSuccessRate, i18n.language)}%`,
        description:
          recentTotals.failure > 0
            ? tr(
                'dashboard.recent_failures_hint',
                '最近窗口内检测到 {{count}} 次失败请求',
                {
                  count: formatInteger(recentTotals.failure, i18n.language),
                }
              )
            : tr('dashboard.all_systems_nominal', '最新快照未发现明显风险'),
        icon: <IconDiamond size={22} />,
        path: '/logs',
        loading: usageLoading,
      },
    ],
    [
      configuredProviderFamilies,
      i18n.language,
      loading,
      models.length,
      modelsLoading,
      providerConfigsReady,
      recentSuccessRate,
      recentTotals.failure,
      recentWindowMinutes,
      stats.apiKeys,
      stats.authFiles,
      stats.disabledAuthFiles,
      t,
      totalProviderConfigs,
      totalRecentRequests,
      tr,
      usageLoading,
    ]
  );

  const attentionItems = useMemo<
    Array<{ tone: InsightTone; title: string; description: string; path: string }>
  >(() => {
    const items: Array<{
      tone: InsightTone;
      title: string;
      description: string;
      path: string;
    }> = [];

    if (connectionStatus !== 'connected') {
      items.push({
        tone: 'danger',
        title: t('common.disconnected'),
        description: tr(
          'dashboard.disconnected_hint',
          '当前未连接到管理 API，配额和用量数据无法实时刷新。'
        ),
        path: '/system',
      });
    }

    if ((stats.disabledAuthFiles ?? 0) > 0) {
      items.push({
        tone: 'warning',
        title: tr('dashboard.disabled_credentials', '已禁用凭证'),
        description: tr(
          'dashboard.disabled_credentials_hint',
          '当前有 {{count}} 个凭证处于禁用状态',
          {
            count: stats.disabledAuthFiles ?? 0,
          }
        ),
        path: '/auth-files',
      });
    }

    if (recentTotals.failure > 0) {
      items.push({
        tone: 'warning',
        title: t('common.failure'),
        description: tr(
          'dashboard.recent_failures_hint',
          '最近窗口内检测到 {{count}} 次失败请求',
          {
            count: formatInteger(recentTotals.failure, i18n.language),
          }
        ),
        path: '/logs',
      });
    }

    if (providerConfigsReady && totalProviderConfigs === 0) {
      items.push({
        tone: 'danger',
        title: tr('dashboard.no_provider_configured', '尚未配置上游'),
        description: tr(
          'dashboard.no_provider_configured_desc',
          '请先添加至少一个上游 provider 配置，再开始转发流量。'
        ),
        path: '/ai-providers',
      });
    }

    if (!modelsLoading && models.length === 0 && connectionStatus === 'connected') {
      items.push({
        tone: 'good',
        title: tr('dashboard.model_inventory', '模型库存'),
        description: tr(
          'dashboard.model_inventory_hint',
          '当前还没有缓存模型列表，待上游准备完成后可前往系统页刷新。'
        ),
        path: '/system',
      });
    }

    if (items.length === 0) {
      items.push({
        tone: 'good',
        title: tr('dashboard.all_systems_nominal', '最新快照未发现明显风险'),
        description: tr(
          'dashboard.healthy_system_desc',
          '连接状态、最近流量和已追踪凭证目前都比较稳定。'
        ),
        path: '/system',
      });
    }

    return items;
  }, [
    connectionStatus,
    i18n.language,
    models.length,
    modelsLoading,
    providerConfigsReady,
    recentTotals.failure,
    stats.disabledAuthFiles,
    t,
    totalProviderConfigs,
    tr,
  ]);

  const routingStrategyRaw = config?.routingStrategy?.trim() || '';
  const routingStrategyDisplay = !routingStrategyRaw
    ? '-'
    : routingStrategyRaw === 'round-robin'
      ? t('basic_settings.routing_strategy_round_robin')
      : routingStrategyRaw === 'fill-first'
        ? t('basic_settings.routing_strategy_fill_first')
        : routingStrategyRaw;
  const routingStrategyBadgeClass = !routingStrategyRaw
    ? styles.configBadgeUnknown
    : routingStrategyRaw === 'round-robin'
      ? styles.configBadgeRoundRobin
      : routingStrategyRaw === 'fill-first'
        ? styles.configBadgeFillFirst
        : styles.configBadgeUnknown;

  const formattedDate = currentTime.toLocaleDateString(i18n.language, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = currentTime.toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const buildDateLabel = safeDateLabel(serverBuildDate, i18n.language);
  const heroStatusClass =
    connectionStatus === 'connected'
      ? styles.connected
      : connectionStatus === 'connecting'
        ? styles.connecting
        : styles.disconnected;
  const heroStatusLabel = serverVersion
    ? `v${serverVersion.trim().replace(/^[vV]+/, '')}`
    : t(
        connectionStatus === 'connected'
          ? 'common.connected'
          : connectionStatus === 'connecting'
            ? 'common.connecting'
            : 'common.disconnected'
      );

  return (
    <div className={styles.dashboard}>
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <div className={styles.heroCopy}>
            <span className={styles.heroEyebrow}>
              {t(`dashboard.greeting_${timeOfDay}`)}
            </span>
            <h1 className={styles.heroTitle}>
              {tr('dashboard.control_center', '运行总览')}
            </h1>
            <p className={styles.heroDescription}>
              {tr(
                'dashboard.control_center_desc',
                '在首页集中查看上游配置、最近请求活跃度、认证凭证状态与关键运行配置，不改任何后端联动。'
              )}
            </p>
          </div>

          <div className={styles.heroMeta}>
            <div className={styles.heroMetaItem}>
              <span className={styles.heroMetaLabel}>
                {tr('dashboard.current_time', '当前时间')}
              </span>
              <strong>{formattedTime}</strong>
            </div>
            <div className={styles.heroMetaItem}>
              <span className={styles.heroMetaLabel}>
                {tr('dashboard.request_window_title', '统计窗口')}
              </span>
              <strong>
                {recentWindowMinutes > 0
                  ? tr('dashboard.request_window', '最近 {{count}} 分钟', {
                      count: recentWindowMinutes,
                    })
                  : tr('dashboard.waiting_for_activity', '等待流量进入')}
              </strong>
            </div>
            <div className={styles.heroMetaItem}>
              <span className={styles.heroMetaLabel}>
                {tr('dashboard.live_status', '实时状态')}
              </span>
              <strong>{formattedDate}</strong>
            </div>
          </div>

          <div className={styles.summaryGrid}>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>
                {tr('dashboard.recent_requests', '最近请求')}
              </span>
              <strong className={styles.summaryValue}>
                {formatInteger(totalRecentRequests, i18n.language)}
              </strong>
              <span className={styles.summaryHint}>
                {tr(
                  'dashboard.traffic_overview_desc',
                  '基于最近请求缓存聚合各 provider 家族的调用情况，便于快速判断流量分布与稳定性。'
                )}
              </span>
            </div>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>
                {tr('dashboard.success_rate', '成功率')}
              </span>
              <strong className={styles.summaryValue}>
                {formatPercent(recentSuccessRate, i18n.language)}%
              </strong>
              <span className={styles.summaryHint}>
                {recentTotals.failure > 0
                  ? tr(
                      'dashboard.recent_failures_hint',
                      '最近窗口内检测到 {{count}} 次失败请求',
                      {
                        count: formatInteger(recentTotals.failure, i18n.language),
                      }
                    )
                  : tr('dashboard.all_systems_nominal', '最新快照未发现明显风险')}
              </span>
            </div>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>
                {tr('dashboard.active_providers', '活跃提供商')}
              </span>
              <strong className={styles.summaryValue}>
                {formatInteger(
                  providerUsage.filter((item) => item.total > 0).length,
                  i18n.language
                )}
              </strong>
              <span className={styles.summaryHint}>
                {tr('dashboard.provider_family_count', '已配置 {{count}} 类提供商', {
                  count: configuredProviderFamilies,
                })}
              </span>
            </div>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLabel}>
                {tr('dashboard.enabled_credentials', '启用凭证')}
              </span>
              <strong className={styles.summaryValue}>
                {enabledCredentials === null
                  ? '-'
                  : formatInteger(enabledCredentials, i18n.language)}
              </strong>
              <span className={styles.summaryHint}>
                {stats.disabledAuthFiles && stats.disabledAuthFiles > 0
                  ? tr(
                      'dashboard.disabled_credentials_hint',
                      '当前有 {{count}} 个凭证处于禁用状态',
                      {
                        count: stats.disabledAuthFiles,
                      }
                    )
                  : tr('dashboard.all_credentials_active', '当前追踪的凭证均已启用')}
              </span>
            </div>
          </div>
        </div>

        <aside className={styles.heroPanel}>
          <div className={styles.heroPanelHeader}>
            <div>
              <span className={styles.heroPanelEyebrow}>
                {tr('dashboard.live_status', '实时状态')}
              </span>
              <h2 className={styles.heroPanelTitle}>
                {tr('dashboard.traffic_overview', '流量概览')}
              </h2>
            </div>
            <span className={`${styles.statusPill} ${heroStatusClass}`}>
              <span className={styles.statusDot} />
              {heroStatusLabel}
            </span>
          </div>

          <div className={styles.panelMetric}>
            <strong className={styles.panelMetricValue}>
              {formatPercent(recentSuccessRate, i18n.language)}%
            </strong>
            <span className={styles.panelMetricLabel}>
              {tr('dashboard.success_rate', '成功率')}
            </span>
          </div>

          <div className={styles.trendBars} aria-hidden="true">
            {overallBuckets.length > 0 ? (
              overallBuckets.map((bucket, index) => {
                const total = bucket.success + bucket.failed;
                const successHeight = Math.max(
                  total > 0 ? (bucket.success / peakBucketTotal) * 100 : 8,
                  total > 0 && bucket.success > 0 ? 10 : 0
                );
                const failureHeight = Math.max(
                  total > 0 ? (bucket.failed / peakBucketTotal) * 100 : 0,
                  total > 0 && bucket.failed > 0 ? 10 : 0
                );

                return (
                  <div key={`${bucket.time ?? 'bucket'}-${index}`} className={styles.trendBar}>
                    <span
                      className={styles.trendBarFailure}
                      style={{ height: `${failureHeight}%` }}
                    />
                    <span
                      className={styles.trendBarSuccess}
                      style={{ height: `${successHeight}%` }}
                    />
                  </div>
                );
              })
            ) : (
              Array.from({ length: 20 }).map((_, index) => (
                <div key={index} className={`${styles.trendBar} ${styles.trendBarIdle}`} />
              ))
            )}
          </div>

          <div className={styles.panelDetails}>
            <div className={styles.detailItem}>
              <span>{tr('dashboard.active_provider', '最活跃提供商')}</span>
              <strong>{topProvider?.label ?? '-'}</strong>
            </div>
            <div className={styles.detailItem}>
              <span>{tr('dashboard.current_version', '当前版本')}</span>
              <strong>{heroStatusLabel}</strong>
            </div>
            <div className={styles.detailItem}>
              <span>{tr('dashboard.build_date', '构建日期')}</span>
              <strong>{buildDateLabel ?? '-'}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>{t('dashboard.system_overview')}</h2>
            <p className={styles.sectionDescription}>
              {tr(
                'dashboard.quick_summary_desc',
                '用更紧凑的方式展示控制面状态与上游准备情况。'
              )}
            </p>
          </div>
        </div>

        <div className={styles.quickGrid}>
          {quickStats.map((item) => (
            <Link key={item.path + item.label} to={item.path} className={styles.quickCard}>
              <div className={styles.quickCardIcon}>{item.icon}</div>
              <div className={styles.quickCardBody}>
                <strong className={styles.quickCardValue}>
                  {item.loading ? '...' : item.value}
                </strong>
                <span className={styles.quickCardLabel}>{item.label}</span>
                <span className={styles.quickCardDescription}>{item.description}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.contentGrid}>
        <div className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>
                {tr('dashboard.traffic_overview', '流量概览')}
              </h2>
              <p className={styles.sectionDescription}>
                {tr(
                  'dashboard.traffic_overview_desc',
                  '基于最近请求缓存聚合各 provider 家族的调用情况，便于快速判断流量分布与稳定性。'
                )}
              </p>
            </div>
          </div>

          <div className={styles.usageList}>
            {providerUsage.length > 0 ? (
              providerUsage.map((item) => {
                const share = topProvider?.total
                  ? Math.max(12, (item.total / topProvider.total) * 100)
                  : 12;

                return (
                  <Link key={item.key} to={item.path} className={styles.usageCard}>
                    <div className={styles.usageHeader}>
                      <div>
                        <strong className={styles.usageName}>{item.label}</strong>
                        <span className={styles.usageSubtext}>
                          {tr('dashboard.configured_upstreams', '{{count}} 项配置', {
                            count: item.configuredCount,
                          })}
                        </span>
                      </div>
                      <span className={styles.usageTotal}>
                        {formatInteger(item.total, i18n.language)}
                      </span>
                    </div>

                    <div className={styles.usageBarTrack}>
                      <span
                        className={styles.usageBarFill}
                        style={{
                          width: `${share}%`,
                          background: `linear-gradient(90deg, var(--success-color) 0 ${
                            item.total > 0 ? item.successRate : 100
                          }%, var(--danger-color) ${
                            item.total > 0 ? item.successRate : 100
                          }% 100%)`,
                        }}
                      />
                    </div>

                    <div className={styles.usageFooter}>
                      <span className={styles.usageMetricSuccess}>
                        {t('common.success')}: {formatInteger(item.success, i18n.language)}
                      </span>
                      <span className={styles.usageMetricFailure}>
                        {t('common.failure')}: {formatInteger(item.failure, i18n.language)}
                      </span>
                      <span className={styles.usageMetricRate}>
                        {formatPercent(item.successRate, i18n.language)}%
                      </span>
                    </div>
                  </Link>
                );
              })
            ) : (
              <div className={styles.emptyPanel}>
                <IconLayoutDashboard size={20} />
                <span>{tr('dashboard.no_recent_activity', '暂时还没有最近请求活动')}</span>
              </div>
            )}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>
                {tr('dashboard.health_center', '健康中心')}
              </h2>
              <p className={styles.sectionDescription}>
                {tr(
                  'dashboard.health_center_desc',
                  '优先展示最可能影响路由、鉴权和配额检查的问题。'
                )}
              </p>
            </div>
          </div>

          <div className={styles.attentionList}>
            {attentionItems.map((item, index) => (
              <Link
                key={`${item.title}-${index}`}
                to={item.path}
                className={`${styles.attentionCard} ${
                  item.tone === 'good'
                    ? styles.attentionGood
                    : item.tone === 'warning'
                      ? styles.attentionWarning
                      : styles.attentionDanger
                }`}
              >
                <div className={styles.attentionHeader}>
                  <strong>{item.title}</strong>
                  <span>{t('common.view', { defaultValue: '查看' })}</span>
                </div>
                <p>{item.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.configSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>{t('dashboard.current_config')}</h2>
            <p className={styles.sectionDescription}>
              {tr(
                'dashboard.configuration_snapshot_desc',
                '这里只展示关键运行开关摘要，具体编辑仍保留在原配置页面中。'
              )}
            </p>
          </div>
        </div>

        <div className={styles.configPillGrid}>
          <div className={styles.configPill}>
            <span className={styles.configPillLabel}>
              {t('basic_settings.debug_enable')}
            </span>
            <span
              className={`${styles.configPillValue} ${
                config?.debug ? styles.on : styles.off
              }`}
            >
              {config?.debug ? t('common.yes') : t('common.no')}
            </span>
          </div>
          <div className={styles.configPill}>
            <span className={styles.configPillLabel}>
              {t('basic_settings.logging_to_file_enable')}
            </span>
            <span
              className={`${styles.configPillValue} ${
                config?.loggingToFile ? styles.on : styles.off
              }`}
            >
              {config?.loggingToFile ? t('common.yes') : t('common.no')}
            </span>
          </div>
          <div className={styles.configPill}>
            <span className={styles.configPillLabel}>
              {t('basic_settings.retry_count_label')}
            </span>
            <span className={styles.configPillValue}>{config?.requestRetry ?? 0}</span>
          </div>
          <div className={styles.configPill}>
            <span className={styles.configPillLabel}>{t('dashboard.routing_strategy')}</span>
            <span className={`${styles.configBadge} ${routingStrategyBadgeClass}`}>
              {routingStrategyDisplay}
            </span>
          </div>
          <div className={styles.configPill}>
            <span className={styles.configPillLabel}>{t('basic_settings.ws_auth_enable')}</span>
            <span
              className={`${styles.configPillValue} ${
                config?.wsAuth ? styles.on : styles.off
              }`}
            >
              {config?.wsAuth ? t('common.yes') : t('common.no')}
            </span>
          </div>
          {config?.proxyUrl && (
            <div className={`${styles.configPill} ${styles.configPillWide}`}>
              <span className={styles.configPillLabel}>
                {t('basic_settings.proxy_url_label')}
              </span>
              <span className={styles.configPillMono}>{config.proxyUrl}</span>
            </div>
          )}
        </div>

        <div className={styles.actionRow}>
          <Link to="/config" className={styles.actionLink}>
            <IconSettings size={16} />
            {tr('dashboard.manage_config', '管理配置')}
          </Link>
          <Link to="/quota" className={styles.actionLink}>
            <IconDiamond size={16} />
            {tr('dashboard.view_quota', '查看配额')}
          </Link>
          <Link to="/logs" className={styles.actionLink}>
            <IconScrollText size={16} />
            {tr('dashboard.view_logs', '查看日志')}
          </Link>
        </div>
      </section>
    </div>
  );
}
