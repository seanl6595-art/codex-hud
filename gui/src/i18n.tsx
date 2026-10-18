import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { readPreference, savePreference } from './formatters.mjs';
export type Language = 'en' | 'zh-CN';
// Each entry has an English and Simplified Chinese message. Add new UI copy here.
const messages = {
  analyticsServerUnavailable: ['This local server did not return model analytics.','当前本地服务未返回模型分析数据。'],
  analyticsRestartHelp: ['Stop and relaunch Codex HUD from the current checkout, then reload this page. Reloading the page alone cannot update an older running backend.','请停止并从当前项目目录重新启动 Codex HUD，然后重新加载页面。仅刷新页面无法更新仍在运行的旧版后端。'],
  loadingAnalytics: ['Loading model and effort analytics…','正在加载模型与推理强度分析…'],
  attributionCoverageTitle: ['Historical attribution coverage','历史归因覆盖情况'],
  attributionCoverageCounts: ['{count} recorded events in this scope · model metadata: {model} · effort metadata: {effort} · safe Input and Output deltas: {valid}.','当前范围记录了 {count} 个事件 · 有模型元数据：{model} · 有强度元数据：{effort} · 输入与输出增量均可安全核算：{valid}。'],
  attributionWorkload: ['Accounted {metric} assigned to known models: {known} · Unknown / Unattributed: {unknown}.','已核算{metric}中，归属于已知模型：{known} · 未知 / 未归因：{unknown}。'],
  allModelAttributionUnknown: ['Event-time model attribution is unavailable or ambiguous. Observed workload remains in Unknown / Unattributed; the current session model is never used to fill history.','事件发生时的模型归因缺失或存在歧义。观测用量保留在“未知 / 未归因”中，不会用会话当前模型填补历史。'],
  attributionCoverageLimits: ['Coverage describes recorded observations only. Partial totals remain visible; cache ratios and workload shares require complete matching observations and denominators.','覆盖情况仅针对已记录观测。不完整总量仍会显示；缓存比例与用量占比仅在匹配观测和分母完整时提供。'],
  includeAutoReview: ['Include Auto Review Sessions','包含自动审核会话'],
  reviewVisibilityNote: ['{hidden} recognized Auto Review sessions hidden. Classification uses observed codex-auto-review metadata, not titles. Historical analytics still include their observed workload.','已隐藏 {hidden} 个已识别的自动审核会话。分类依据观测到的 codex-auto-review 元数据，而非标题。历史分析仍包含其观测用量。'],
  checkSources: ['Check sources (read-only)','检查数据源（只读）'], checkingSources: ['Checking sources…','正在检查数据源…'],
  syncComplete: ['Sync completed successfully','同步成功完成'], syncPartial: ['Sync completed with source issues','同步已完成，部分数据源需处理'], syncFailed: ['Sync failed; no sources were checked successfully','同步失败，没有成功检查的数据源'],
  inspectionComplete: ['Source validation completed','数据源校验完成'], inspectionIssues: ['Source validation found issues','数据源校验发现问题'],
  newEventsCollected: ['New events collected','新增采集事件'], sourcesChecked: ['Sources successfully checked','成功检查的数据源'], sourcesFailed: ['Sources failed','失败的数据源'], sourcesSkipped: ['Sources skipped','跳过的数据源'],
  duplicateFilesSkipped: ['Duplicate files skipped','跳过的重复文件'], sourcesAwaitingAppend: ['Sources awaiting more data','等待追加数据的数据源'], inheritedHistoriesRecognized: ['Inherited histories recognized','已识别的继承历史'], rebuiltSources: ['Sources rebuilt','重建的数据源'],
  sourceIssueDetails: ['Source issue details','数据源问题详情'], errorType: ['Error type','问题类型'], affectedSources: ['Count','数量'], explanation: ['Explanation','说明'],
  sourceIdentityConflict: ['A canonical identity changed inside this source. The source transaction was rejected; its recorded history was preserved.','此数据源内部的规范身份发生变化。已拒绝该数据源的事务，并保留原有记录历史。'],
  sourceCopiesConflict: ['Copies of one canonical source disagree. No copy was selected for ingestion.','同一规范数据源的副本内容不一致，未选择任何副本进行采集。'],
  sourceForkPending: ['The declared inherited-history boundary has not been completely written yet. This source is waiting, not discarded.','声明的继承历史边界尚未完整写入。此数据源正在等待，不会被丢弃。'],
  sourceForkConflict: ['Fork lineage, history boundary, or checkpoint is inconsistent. Identity safeguards remain enforced.','分支来源、历史边界或检查点不一致。仍严格执行身份校验。'],
  sourceMalformed: ['A complete source record could not be parsed. Its transaction was rolled back.','无法解析已完整写入的数据源记录，已回滚该数据源事务。'],
  sourceChanged: ['Source bytes changed during the read. Retry after the source settles.','读取过程中数据源字节发生变化，请在其稳定后重试。'],
  sourceReadFailed: ['This source could not be checked or collected. The error code identifies the failure.','无法检查或采集此数据源，问题代码标明了失败原因。'],
  sourceOwnershipConflict: ['A record belongs to a different thread than the declared history permits. Existing history is preserved.','某条记录的所属线程与声明的历史范围不一致。已有历史保持不变。'],
  sourceUnsupportedHistory: ['The inherited-history declaration is unsupported or incomplete. Existing history is preserved.','继承历史声明不受支持或不完整。已有历史保持不变。'],
  failedHistoryPreserved: ['History for failed sources stays intact: their transactions roll back. Other sources may add events or rebuild changed history.','失败数据源的事务会回滚，保留其原有历史。其他数据源可能新增事件或重建已变化的历史。'],
  inspectionDoesNotWrite: ['Read-only check: no events, checkpoints, source files or recorded history were changed.','只读检查：未修改事件、检查点、数据源文件或已记录历史。'],
  syncNotRun: ['No sync has run in this server session. Check sources without collecting, or choose Sync once.','当前服务启动后尚未同步。可以只读检查数据源，也可以选择“同步一次”。'],
  sourceInspection: ['Read-only source diagnostics','只读数据源诊断'], sourceInspectionAt: ['Checked at {time}','检查时间：{time}'],
  sourceInspectionHelp: ['Check source identities, fork boundaries and checkpoints without starting collection or writing to the database.','检查数据源身份、分支边界和检查点，不启动采集，也不写入数据库。'],
  pendingSourceEvents: ['{count} unrecorded token events in unchanged/new sources · {changed} changed sources require the normal guarded rebuild path.','未变化或新增数据源中有 {count} 个尚未记录的 Token 事件 · {changed} 个已变化的数据源需要按现有保护流程重建。'],

  expandChart: ['Expand {title}', '展开{title}'], closeChart: ['Close expanded chart','关闭展开图表'],
  connectGaps: ['Connect gaps','连接缺失间隔'], gapGuideNote: ['Dashed guides connect known endpoints only; missing intervals have no values and never affect totals.','虚线仅连接已知端点；缺失区间没有数值，也不影响总量。'],
  splitScales: ['Separate Input / Output scales','分开输入 / 输出刻度'], independentScale: ['independent scale','独立刻度'],
  resetZoom: ['Reset zoom','重置缩放'], brushHelp: ['Drag the handles below to zoom into time.','拖动下方手柄缩小时间范围。'],
  scaleHelp: ['Hide a metric or expand with separate scales to inspect smaller Output values.','可隐藏某个指标，或展开后使用独立刻度查看较小的输出值。'],
  calendarWindow: ['Calendar window','日历范围'], weeks: ['{count} weeks','{count} 周'], earlierWeek: ['Earlier week','向前一周'], laterWeek: ['Later week','向后一周'], today: ['Today','今天'],
  observedWorkload: ['Observed tokens','观测 Token'],
  modelAnalytics: ['Model usage analysis','模型用量分析'], analyticsSubtitle: ['Event-time attribution · same selected Statistics period','按事件时元数据归因 · 使用所选统计时段'],
  modelDistribution: ['Model distribution','模型分布'], workload: ['Measured workload','用量指标'], combined: ['Input + Output','输入 + 输出'],
  modelFilter: ['Model filter','模型筛选'], effortFilter: ['Effort filter','强度筛选'], allModels: ['All models','全部模型'], allEfforts: ['All efforts','全部强度'],
  unknownAttribution: ['Unknown / Unattributed','未知 / 未归因'], analyticsFilters: ['Analytics filters','分析筛选条件'],
  analyticsDenominator: ['Shares use filtered period accounted {metric}, including Unknown. Incomplete denominators withhold shares.','占比以筛选后时段的已核算{metric}为分母，包含未知类别。分母不完整时不显示占比。'],
  modelTable: ['Model analytics','模型明细'], observedTurns: ['Observed Turns','观测轮次'], distinctSessions: ['Distinct Sessions','不同会话'], cacheRatio: ['Matched cache ratio','匹配缓存比例'], inputWorkloadShare: ['Input workload share','输入用量占比'],
  effortBreakdown: ['Effort breakdown','强度分布'], analyticsLimit: ['Model display limit','模型显示数量'], searchModels: ['Search models','搜索模型'],
  modelTrend: ['Model usage over time','模型用量趋势'], modelTrendHelp: ['Model colors stay consistent. Stacked bars use one workload metric; line gaps retain missing observations.','模型颜色保持一致。堆叠柱图使用同一个用量指标；折线保留缺失观测的间隔。'],
  effortAnalytics: ['Reasoning effort analysis','推理强度分析'], effortSubtitle: ['Compare observed effort within the current model and effort filters.','在当前模型与强度筛选条件下比较观测用量。'],
  attributionNote: ['Ambiguous metadata transitions stay Unknown. Usage Events require positive accounted Input or Output; they are not request counts. Observed Turns deduplicate session + turn IDs on those events; * marks missing identity or time coverage. Distinct session and turn counts across groups are not additive.','元数据切换无法明确归因时保留为未知。用量事件指存在正向已核算输入或输出的事件，不等于请求数。观测轮次按这些事件的会话 + 轮次 ID 去重；* 表示身份或时间覆盖缺失。各组会话数与轮次数不可相加。'],
  qualityDetails: ['Data coverage and attribution','数据覆盖与归因'], coverageDetail: ['{count} observations in the filtered period · {unknown} observations with unassignable timestamps across history. Missing telemetry is not evidence of zero activity.','筛选后时段有 {count} 次观测 · 全部历史中有 {unknown} 次观测的时间戳无法归属。缺失遥测不代表没有活动。'],
  relatedSessions: ['Related sessions','相关会话'], selectedModel: ['Selected model','所选模型'], clearFilters: ['Clear analytics filters','清除分析筛选'],
  noAnalytics: ['No observations match these analytics filters. Try another model, effort, or time range.','没有符合分析筛选条件的观测。请尝试其他模型、强度或时间范围。'],
  modelSeriesLimit: ['Series limit','显示序列数'], seriesNote: ['Showing {count} model series. Use All to include every model; filtering never changes accounting.','当前显示 {count} 个模型序列。选择“全部”可显示所有模型；筛选不会改变核算结果。'],
  selectedRange: ['Selected Statistics period','所选统计时段'], distributionShare: ['Workload share','用量占比'],
  effortMinimal: ['Minimal','极低'], effortLow: ['Low','低'], effortMedium: ['Medium','中'], effortHigh: ['High','高'], effortXhigh: ['Extra high','极高'], effortNone: ['None','无'], effortAuto: ['Auto','自动'],

  dashboard: ['Dashboard','概览'], statistics: ['Statistics','统计分析'], sessions: ['Sessions','会话'], recorder: ['Recorder','记录器'],
  overviewTitle: ['Usage overview','用量概览'], overviewSubtitle: ['Your local Codex workload, brought into focus.','一览本机 Codex 的用量与活动。'],
  statisticsSubtitle: ['Explore accounted usage across time and sessions.','按时间和会话深入分析已核算用量。'],
  sessionsSubtitle: ['Inspect the latest known telemetry for each session.','查看各会话最新已知的遥测数据。'],
  recorderSubtitle: ['Keep a durable history of locally observed activity.','持续保存本机观察到的活动历史。'],
  observability: ['Local observability','本地可观测性'], mainNavigation: ['Main navigation','主导航'], toggleNavigation: ['Toggle navigation','展开或收起导航'],
  localConnection: ['Local connection','本地连接'], language: ['Language','界面语言'],
  onMachine: ['On your machine.','数据就在本机。'], localPrivacy: ['Your telemetry stays local. No API keys, uploads, or extra quota.','遥测数据保留在本机。无需 API 密钥，不上传数据，也不额外消耗额度。'],
  syncingTelemetry: ['Syncing telemetry','正在同步遥测'], recorderActive: ['Recorder active','记录器运行中'], recorderIdle: ['Recorder idle','记录器未运行'],
  preview: ['GUI preview · v1.3','GUI 预览版 · v1.3'], refresh: ['Refresh','刷新'], refreshDashboard: ['Refresh dashboard','刷新仪表盘'], reconnect: ['Reconnect','重新连接'],
  input: ['Input','输入'], cached: ['Cached','缓存'], fresh: ['Fresh','新输入'], output: ['Output','输出'], reasoning: ['Reasoning','推理'],
  usageEvents: ['Usage Events','用量事件'], periodSummary: ['Period usage summary','所选时段用量汇总'], accountedTokens: ['Accounted tokens','已核算 Token'],
  includedInput: ['Included in Input','包含在输入中'], inputMinusCached: ['Input minus Cached','输入减去缓存'], includedOutput: ['Included in Output','包含在输出中'],
  positiveUsage: ['Positive accounted usage','有正向核算用量'], withActivity: ['With accounted activity','有核算活动的会话'],
  partialObservation: ['Partial observation','部分遥测'], incompleteTelemetry: ['Incomplete telemetry','遥测不完整'], tokenUnit: ['tokens','Token'],
  unknown: ['Unknown','未知'], notAvailable: ['Not available','不可用'], partial: ['Partial','部分'], complete: ['Complete','完整'],
  endExclusive: ['end exclusive','不含结束时刻'], statsFailed: ['Could not update Statistics.','无法更新统计数据。'],
  lastResult: ['The last successful result remains below.','下方保留上次成功获取的结果。'],
  incompleteWarning: ['Some recorded usage cannot be safely accounted. Asterisks mark partial totals; percentages requiring incomplete totals are withheld. Successful sync does not resolve missing usage.','部分已记录用量无法安全核算。星号标记不完整总量；依赖不完整总量的百分比不予显示。同步成功不代表缺失用量已解决。'],
  accountingDetails: ['Why incomplete?','为何不完整？'],
  reason_unknown: ['Unresolved usage observation','用量观测尚无法确认'],
  reason_missing_cumulative: ['Missing or invalid cumulative counter','累计计数缺失或无效'],
  reason_missing_last: ['Missing last usage for a baseline or reset','基线或重置所需的最近用量缺失'],
  reason_unsafe_baseline: ['First usage has no safe baseline','首次用量缺少可靠基线'],
  reason_missing_predecessor: ['Previous usage counter is unavailable','前一条用量计数不可用'],
  reason_unrecognized_reset: ['Unexplained cumulative decrease','累计计数下降原因不明'],
  reason_ambiguous_reset: ['Counter reset scope is uncertain','计数重置范围不明确'],
  reason_source_integrity: ['Recorded history conflicts with verified source evidence (sources)','已记录历史与已验证来源证据不一致（来源数）'],
  historyEvidenceScope: ['Recorded history uses previous source checks; files are not rechecked on every filter change.','已记录历史使用先前验证的来源证据；更改筛选条件不会每次重新检查文件。'],
  historyEvidencePartial: ['Some source evidence is unavailable or conflicting; check the completeness of each metric.','部分来源证据不可用或存在冲突；请查看各项指标的完整性。'],
  historyEvidenceSince: ['Oldest source check:','最早来源验证时间：'],
  recheckHistorySources: ['Recheck source files','重新验证来源文件'],
  checkingHistorySources: ['Checking source files…','正在验证来源文件…'],
  reason_sequence_gap: ['Recorded event sequence has a gap','已记录事件序列存在缺口'],
  reason_unknown_provenance: ['Cannot verify whether this event contains usage','无法验证此事件是否包含用量'],
  reason_missing_input_or_cached: ['Input or Cached delta is unavailable','输入或缓存增量不可用'],
  reason_invalid_cache_subset: ['Cached/Input counters or deltas are inconsistent','缓存与输入计数或增量不一致'],
  reason_invalid_reasoning_subset: ['Reasoning/Output counters or deltas are inconsistent','推理与输出计数或增量不一致'],
  reason_unknown_timestamp: ['Usage cannot be assigned to a time period','用量无法分配到时间段'],
  unknownTimes: ['Some observations have unknown timestamps and cannot be assigned to a period.','部分观测缺少有效时间戳，无法归入具体时段。'],
  historyStarts: ['Your history starts here','从这里开始记录历史'],
  historyHelp: ['Sessions can be explored now. To see historical charts and token activity, sync your local telemetry into the Recorder database.','现在即可浏览会话。要查看历史图表和 Token 活动，请先将本机遥测同步到记录器数据库。'],
  openRecorder: ['Open Recorder','打开记录器'], optInHelp: ['Collection starts only when you choose Start recording or Sync once.','仅在您选择“开始记录”或“同步一次”后才开始采集。'],
  loadingDashboard: ['Loading dashboard','正在加载仪表盘'], loadingChart: ['Loading chart…','正在加载图表…'], loadingHeatmap: ['Loading 12-week activity…','正在加载最近 12 周的活动…'],
  sourcesIncomplete: ['Some local sources could not be read. The session list may be incomplete.','部分本地数据源无法读取，会话列表可能不完整。'],
  privacyNote: ['Locally observed workload. Not official billing or subscription quota usage.','本机观察到的工作用量，不代表官方账单或订阅额度消耗。'],
  privateDefault: ['Private by default','默认保护隐私'],
  rangeLabel: ['Statistics time range','统计时间范围'], quickRanges: ['Quick time ranges','快捷时间范围'],
  range24: ['24 hours','24 小时'], range48: ['48 hours','48 小时'], range7: ['7 days','7 天'], range30: ['30 days','30 天'],
  lookback: ['Lookback','回溯时长'], customRange: ['Custom range','自定义范围'], updating: ['Updating…','正在更新…'], localTime: ['Local time','本地时间'],
  startDate: ['Start date and time','开始日期和时间'], endDate: ['End date and time','结束日期和时间'],
  lookbackAmount: ['Lookback amount','回溯数值'], lookBack: ['Look back','回溯'], durationUnit: ['Duration unit','时长单位'],
  hours: ['hours','小时'], days: ['days','天'], timezone: ['Timezone','时区'], applyRange: ['Apply range','应用范围'],
  rangeNote: ['Start included, end excluded. Ambiguous or nonexistent local times are rejected.','包含开始时刻，不含结束时刻。不接受夏令时切换中有歧义或不存在的本地时间。'],
  analyzeRange: ['Analyze this range','深入分析此范围'],
  inputComposition: ['Input composition','输入构成'], matchedCohort: ['Matched accounted Input cohort','已匹配的核算输入观测组'],
  cachedInput: ['cached input','缓存输入'], proportions: ['Cached and fresh Input proportions','缓存与新输入占比'],
  cacheNote: ['Cached + Fresh = Input. These are subsets, not additional workload.','缓存 + 新输入 = 输入。它们是输入的组成部分，不是额外用量。'],
  positiveDenominator: ['A positive Input denominator is needed for percentages.','输入量必须大于零才能计算百分比。'],
  unavailableRatio: ['Percentages are unavailable while matched telemetry is incomplete.','匹配的遥测不完整，暂不显示百分比。'],
  usageOverTime: ['Usage over time','用量趋势'], hourlyDeltas: ['Hourly accounted deltas','每小时核算增量'], dailyDeltas: ['Daily accounted deltas','每日核算增量'],
  chartDescription: ['Input and Output token usage over time','随时间变化的输入和输出 Token 用量'],
  chartType: ['Chart type','图表类型'], bar: ['Bar chart','柱状图'], line: ['Line chart','折线图'],
  chartGaps: ['Gaps indicate no recorded observations. Outlined marks indicate partial metrics; their available deltas are retained.','空缺表示没有记录到观测。描边标记表示不完整指标，仅保留其可核算增量。'],
  chartNoObservations: ['No recorded observations in this bucket.','此时间桶没有记录到观测。'],
  topSessions: ['Top sessions','热门会话'], sessionRanking: ['Session ranking','会话排行'], rankedInput: ['Ranked by accounted Input','按已核算输入量排序'],
  sessionCount: ['{count} sessions','{count} 个会话'], shareUnavailable: ['Share unavailable','占比不可用'], inputShare: ['{value}% of Input','占输入 {value}%'],
  rankingEmpty: ['No accounted Usage Events in this period. Try a wider range or sync local history.','此时段没有已核算的用量事件。请扩大范围或同步本地历史。'],
  currentNames: ['Current display names · canonical session IDs','使用当前会话名称与规范会话 ID'],
  searchRanking: ['Search all ranked sessions','搜索全部排行会话'], searchRankingPlaceholder: ['Search every session by name or ID','按名称或 ID 搜索全部会话'],
  rankingLimit: ['Ranking limit','排行显示数量'], topN: ['Top {count}','前 {count} 名'], all: ['All','全部'],
  noRankMatch: ['No sessions match this filter. Search covers the full ranking dataset.','没有符合筛选条件的会话。搜索覆盖完整排行数据。'],
  showingMatches: ['Showing {from}–{to} of {count} matching sessions','显示第 {from}–{to} 条，共 {count} 个匹配会话'],
  showMore: ['Show more','显示更多'], showLess: ['Show less','收起'], previous: ['Previous','上一页'], next: ['Next','下一页'],
  pageOf: ['Page {page} of {pages}','第 {page} 页，共 {pages} 页'], analyzeSessions: ['Analyze all sessions','分析全部会话'],
  shareNote: ['Shares use the full period Input denominator; filtering does not change accounting.','占比的分母为整个时段的输入量；筛选不会改变核算结果。'],
  inspectBuckets: ['Inspect accounted time buckets','展开查看核算时间桶'], bucket: ['Bucket','时间桶'], observations: ['Observations','观测数'], dataStatus: ['Data status','数据状态'],
  heatmap: ['Token activity','Token 活动'], heatmapSubtitle: ['Last 12 weeks · local calendar days · independent of Statistics','最近 12 周 · 按本地自然日 · 独立于统计范围'],
  activeDays: ['{count} active days','{count} 个活跃日'], less: ['Less','少'], more: ['More','多'],
  zeroRecorded: ['Recorded zero','已记录为零'], noObservations: ['No observations','无观测'], incomplete: ['Incomplete','不完整'],
  missingDescription: ['No recorded observations; activity is unknown.','没有记录到观测，实际活动未知。'],
  incompleteDescription: ['Incomplete Input or Output telemetry; values may be partial.','输入或输出遥测不完整，数值可能仅为部分用量。'],
  zeroDescription: ['Recorded observations account for zero tokens.','已有观测的核算 Token 用量为零。'],
  completeDescription: ['Complete Input and Output accounting for recorded observations.','已有观测的输入和输出均已完整核算。'],
  activityUnknown: ['Activity unknown','活动未知'], recordedActivity: ['recorded activity','已记录活动'],
  observedTokens: ['12-week observed tokens','12 周观测 Token'], inputPlusOutput: ['Input + Output','输入 + 输出'],
  observationCount: ['{count} observations','{count} 次观测'], calendarDate: ['Local calendar date · {timezone}','本地自然日 · {timezone}'],
  heatScale: ['Five bands relative to the largest complete day ({max}).','五档强度相对于完整观测中的最高日用量（{max}）。'],
  intensityBand: ['Level {level}: {band} of the largest complete day.','第 {level} 档：最高完整日用量的 {band}。'],
  observedDays: ['Days observed','有观测的天数'], weekMon: ['Mon','一'], weekWed: ['Wed','三'], weekFri: ['Fri','五'], weekSun: ['Sun','日'],
  sessionBrowser: ['Session browser','会话浏览器'], searchSessions: ['Search sessions','搜索会话'], searchSessionsPlaceholder: ['Search name, project, or model','搜索名称、项目或模型'],
  modelUnknown: ['Model unknown','模型未知'], noSessionsMatch: ['No sessions match your search.','没有匹配的会话。'],
  noLocalSessions: ['No local sessions found. Local Codex telemetry is required.','未找到本地会话。需要本机 Codex 遥测数据。'],
  loadingSession: ['Loading session…','正在加载会话…'], archived: ['Archived','已归档'], localSession: ['Local session','本地会话'], recordedHistory: ['Recorded history','已记录历史'],
  model: ['Model','模型'], reasoningEffort: ['Reasoning effort','推理强度'], latestUsage: ['Latest usage','最近用量'],
  latestSnapshot: ['Latest request snapshot','最近一次请求快照'], missingLocalTelemetry: ['Local session telemetry is unavailable. Recorded event metadata remains below.','无法读取本地会话遥测；下方仍可查看已记录的事件元数据。'],
  contextEstimate: ['Context estimate','上下文估计'], contextNote: ['Last-request Input, not live occupancy.','根据最近请求的输入估计，不代表实时上下文占用。'],
  contextValues: ['{input} / {window} tokens','{input} / {window} Token'], sourceIncomplete: ['Source telemetry is incomplete or still being written.','数据源遥测不完整或仍在写入。'],
  recentActivity: ['Recent recorded activity','最近记录的活动'], snapshotsNote: ['Observed request snapshots in source order. These values are not added as workload.','按数据源顺序显示观测到的请求快照。这些数值不会相加为用量。'],
  event: ['Event','事件'], observedAt: ['Observed at','观测时间'], lastInput: ['Last Input','最近输入'], lastOutput: ['Last Output','最近输出'],
  noRecentEvents: ['No recorded events yet. Sync local history from Recorder.','尚无已记录事件。请通过记录器同步本地历史。'],
  chooseSession: ['Choose a session to explore its telemetry.','请选择一个会话查看遥测数据。'],
  localRecorder: ['Local Recorder','本地记录器'], recorderHelp: ['Collect observed telemetry into your local SQLite history.','将观测到的遥测保存到本地 SQLite 历史数据库。'],
  syncing: ['Syncing','同步中'], recording: ['Recording','记录中'], stopped: ['GUI recorder stopped','GUI 记录器已停止'],
  startRecording: ['Start recording','开始记录'], stopRecording: ['Stop recording','停止记录'], syncOnce: ['Sync once','同步一次'],
  starting: ['Starting…','正在启动…'], stopping: ['Stopping…','正在停止…'], syncingHistory: ['Syncing history…','正在同步历史…'],
  recorderOptIn: ['Recording is opt-in. Opening this dashboard does not create a database or start collection.','记录功能需主动开启。打开仪表盘不会创建数据库，也不会开始采集。'],
  recordedEvents: ['Recorded events','已记录事件'], logicalSources: ['Logical sources','逻辑数据源'], lastGuiSync: ['Last GUI sync','最近 GUI 同步'],
  notSynced: ['Not synced this run','本次运行尚未同步'], latestSourceUpdate: ['Latest source update','最近数据源更新'],
  database: ['Database','数据库'], available: ['Available','可用'], notCreated: ['Not created','尚未创建'], loadingDatabase: ['Loading database location…','正在加载数据库位置…'],
  syncResult: ['Last sync result','最近同步结果'], syncCounts: ['{events} new events · {rebuilt} rebuilt sources · {partial} partial sources','新增 {events} 个事件 · 重建 {rebuilt} 个数据源 · {partial} 个不完整数据源'],
  recorderOwnership: ['Controls affect this GUI recorder only. External CLI recorder status is unknown.','这些控件仅管理当前 GUI 的记录器；独立 CLI 记录器的状态未知。'],
  errorConnection: ['Could not connect to the local server.','无法连接本地服务器。'], errorRequest: ['The local request failed.','本地请求失败，请重试。'],
  errorRead: ['The local database could not be read. Check the database and retry.','无法读取本地数据库。请检查数据库后重试。'],
  errorAmbiguous: ['Local datetime is ambiguous in this timezone (daylight-saving transition); choose an unambiguous boundary.','该本地时间在夏令时切换中有歧义，请选择明确的时间边界。'],
  errorNonexistent: ['Local datetime does not exist in this timezone (daylight-saving transition).','该本地时间在夏令时切换中不存在，请选择其他时间。'],
  errorDate: ['Invalid local date or time.','本地日期或时间无效。'], errorOrder: ['End must be later than start.','结束时间必须晚于开始时间。'],
  errorBothDates: ['Choose both a start and end time.','请选择开始时间和结束时间。'], errorLookback: ['Lookback must be between 1 and 8784 hours.','回溯时长必须介于 1 至 8784 小时之间。'],
  errorRange: ['Choose a range of at most 366 days.','请选择不超过 366 天的时间范围。'], errorTimezone: ['Invalid timezone.','时区无效。'],
  errorDbMissing: ['Recorder database not found. Sync local history first.','未找到记录器数据库，请先同步本地历史。'],
  errorSchema: ['This database schema is unsupported; no changes were made.','不支持此数据库架构，未对数据库作任何修改。'],
  errorReload: ['Reload this page to reconnect to the local server.','请重新加载页面以连接本地服务器。'],
  errorRecorder: ['Recorder could not sync the local database.','记录器无法同步本地数据库。'],
  errorPartialSources: ['Some sources could not be collected. Review the sync result.','部分数据源未能采集，请查看同步结果。'],
  errorNotFound: ['Session not found.','未找到该会话。']
} as const;
export type MessageKey = keyof typeof messages;
type Parameters = Record<string, string | number>;
const locales = { en: 'en-US', 'zh-CN': 'zh-CN' } as const;
type I18n = { language: Language; locale: string; setLanguage: (language: Language) => void;
  t: (key: MessageKey, values?: Parameters) => string; errorText: (error: unknown) => string;
  time: (value: string | null | undefined, timezone?: string) => string };
const Context = createContext<I18n | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, changeLanguage] = useState<Language>(() => readPreference('codex-hud.language.v1', ['en','zh-CN'], 'en'));
  const setLanguage = useCallback((next: Language) => { changeLanguage(next); savePreference('codex-hud.language.v1', next); }, []);
  const t = useCallback((key: MessageKey, values: Parameters = {}) => {
    const message: string = messages[key][language === 'en' ? 0 : 1];
    return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? '{' + name + '}'));
  }, [language]);
  const errorText = useCallback((error: unknown) => {
    const e = error as { message?: string; code?: string }, message = e?.message || String(error || '');
    if (language === 'en') return message || t('errorRequest');
    const key: MessageKey = /ambiguous/i.test(message) ? 'errorAmbiguous'
      : /does not exist.*timezone/i.test(message) ? 'errorNonexistent'
      : /both|Choose both/i.test(message) ? 'errorBothDates'
      : /later than/i.test(message) ? 'errorOrder'
      : /Invalid local datetime|Invalid Stats timestamp/i.test(message) ? 'errorDate'
      : /Lookback must/i.test(message) ? 'errorLookback'
      : /366 days/i.test(message) ? 'errorRange'
      : /Invalid timezone|Invalid time zone/i.test(message) ? 'errorTimezone'
      : e?.code === 'DB_MISSING' || /database not found/i.test(message) ? 'errorDbMissing'
      : /schema/i.test(message) ? 'errorSchema'
      : e?.code === 'FORBIDDEN' || /Reload this page/i.test(message) ? 'errorReload'
      : /Some sources/i.test(message) ? 'errorPartialSources'
      : e?.code === 'RECORDER_ERROR' || /Recorder could not/i.test(message) ? 'errorRecorder'
      : e?.code === 'NOT_FOUND' ? 'errorNotFound'
      : /connect|fetch/i.test(message) ? 'errorConnection'
      : e?.code === 'READ_ERROR' ? 'errorRead' : 'errorRequest';
    return t(key);
  }, [language, t]);
  const time = useCallback((value: string | null | undefined, timezone?: string) => value ? new Intl.DateTimeFormat(locales[language], {
    dateStyle: 'medium', timeStyle: 'short', timeZone: timezone
  }).format(new Date(value)) : t('notAvailable'), [language, t]);
  useEffect(() => { document.documentElement.lang = language; document.title = 'Codex HUD · ' + t('observability'); }, [language, t]);
  const value = useMemo(() => ({ language, locale: locales[language], setLanguage, t, errorText, time }), [language, setLanguage, t, errorText, time]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() { const context = useContext(Context); if (!context) throw new Error('I18nProvider is required.'); return context; }
