# Distribution 项目分析文档

## 业务背景

> Evaluate SKU distribution completion status at POC-Group-month level as M1 performance.
>
> 以 **售点(POC) × KPI组(Group) × 月份** 为粒度，评估 M1 业代的分销品项达成情况，作为其绩效考核依据。

### 关键实体定义

| 实体 | 字段 | 说明 |
|------|------|------|
| 业代 | `m1_no` | M1 一线销售人员的工号 (employee_no) |
| 售点 | `poc_middle_id` | 门店/售点的唯一标识 (poc_id) |
| KPI 组 | `group_code` | 分配给业代-售点的必售品项组，每月可能变化 |
| SKU Key | `mha_sku_key` | 品项标识，有两种类型：Subbrand×PACK 和 CIO Code |
| 月份 | `yearmonth` | 数据月份分区键，KPI 配置和达成均需按月对齐 |

### 重要数据关系

- 一个 `group_code` 可对应 **多个** `mha_sku_key`（一对多），即每个 KPI 组下包含多个具体品项
- 每个 `(POC, group_code)` 组合代表该业代在该售点的 **一项 KPI 要求**
- KPI 配置和达成定义 **可能随月份变化**，所有分析必须按月对齐
- MHA 达成需从两个视角评估：**售点级别** 和 **售点×Group 级别**

## 项目概述

本项目围绕 **M1 业代分销覆盖** 展开，涵盖三大分析主题：
1. **MHA 达成分析** — 必售品项（Must Have Assortment）在各售点的达成情况追踪
2. **M1 造假检测** — 从箱码、GPS、订单匹配、QR 码真伪等维度识别业代扫码造假
3. **售点排序与画像** — 基于 SKU 生命周期、热卖度、协同过滤的智能推荐排序

## 语义层优先级

本项目的准确分析路径应优先使用 Databricks Metric Views 作为统一语义层，
而不是让 Agent 每次从明细表重新推导指标口径。

v0.3.5 的上下文工程目标：

- 从业务描述、分析笔记、Notebook/SQL、Unity Catalog 元数据和数据画像中提取指标口径
- 将稳定指标沉淀为 Metric View 的维度、度量、过滤条件、同义词和展示格式
- 用源表 SQL 校验 Metric View 输出
- 在 `distribution.yaml` 中注册已验证的 Metric Views
- 在 v0.4 Golden Analysis Cases 中优先引用 Metric Views，源表 SQL 作为验证和兜底路径

当前优先认证：

| Metric View | 用途 |
|---|---|
| `m1_achievement_detail_metrics` | POC × Group × SKU Key × Month 达成明细 |
| `m1_poc_achievement_metrics` | POC × Month 达成汇总 |
| `m1_kpi725_benchmark_metrics` | KPI725 目标/实际与 scan 侧对账 |

详细设计见 `metric-view-design.md` 和 `metric-view-context-engineering.md`。
v0.3.5 场景准备产物见 `requirements.md`、`inventory.md`、`gap-analysis.md`
和 `readiness.md`；MV1-MV3 的候选校验 SQL 位于 `metric-views/`。

---

## 一、数据资产

### Schema：`gld_apc_sales_m1_scan_dw`（20 张表，Delta 格式）

```
┌──────────────────────────────────────────────────────┐
│                    上游外部数据源                       │
│  techsales_db.m1_scan_visit_base    售点拜访基础表     │
│  bcc_...ods.report_import_mapping_sku  SAP SKU 主数据 │
│  poc_datahub_dw.poc_master_daily_fact  售点主数据      │
│  org_datahub_dw.employee_relation_m1m2m3  人员关系     │
└────────────────────────┬─────────────────────────────┘
                         │
    ┌────────────────────┼────────────────────┐
    ▼                    ▼                    ▼
┌─────────┐       ┌──────────┐         ┌──────────┐
│ scan    │       │  bees    │         │   kbd    │
│ detail  │       │ detail   │         │  detail  │
│ (扫码)  │       │ (BEES)   │         │  (KA)    │
└────┬────┘       └────┬─────┘         └────┬─────┘
     │                 │                    │
     └────────┬────────┴────────────────────┘
              │  UNION (yearmonth, poc, m1_no)
              ▼
     ┌────────────────────┐
     │  分销大宽表          │
     │  m1_poc_sku_df      │
     └────────┬───────────┘
              │
   ┌──────────┼──────────┬──────────────┐
   ▼          ▼          ▼              ▼
┌───────┐ ┌───────┐ ┌────────┐  ┌──────────┐
│dist.  │ │mha sku│ │BEESForce│ │达成率     │
│achieve│ │achieve│ │运营表   │ │指标表    │
│detail │ │detail │ │         │ │          │
│+summary│+summary│ │         │ │          │
└───────┘ └───────┘ └────────┘ └──────────┘
```

### 表分层

| 层级 | 表数量 | 说明 |
|------|--------|------|
| 源数据层 | 7 | `scan_detail`, `bees_distribution_detail*`, `kbd_detail`, `record_all`, `task_split`, `task_mapping_record` |
| 达成明细层 | 2 | `distribution_achievement_detail`, `mha_sku_achievement_detail` |
| 达成汇总层 | 2 | `distribution_achievement_summary`, `mha_sku_achievement_summary` |
| 运营推送 | 4 | BEESForce progress / not_achieved_poc（全量 + 当月） |
| 指标率 | 2 | `mha_sku_achieved_rate`（全量 + 当月） |
| 归档 | 3 | `_archive0123` 后缀表 |

---

## 二、Notebook 清单与分析思路

### 2.1 MHA_achievement_analysis — MHA 达成分析

**分析问题**：各售点每月的 MHA（必售品项）达成情况如何？

**数据源**：
- `m1_scan_distribution_achievement_detail` — 达成明细（月×售点×Group×SKU Key）
- `m1_scan_distribution_achievement_summary` — 达成汇总（月×售点，含达成数量/日期）

**达成判定逻辑（分层阈值）**：

| 业态 | 需覆盖 Group 数 | 需达成数 |
|------|:-------------:|:------:|
| 大卖场 / 普通超市 / 现购自运 / 高端超市 | ≥5 | ≥5 |
| 普通便利店 / 高端便利店 / 油站便利店 | ≥4 | ≥4 |
| 通用规则 | count = N | sum = N（全部达成） |

**渠道清洗**：`IH→TT`，`NULL→KA`，排除 `T2WS`

---

### 2.2 M1_Fraud 系列（4 个 Notebook）— 造假检测

#### 需求背景

识别 M1 业代在扫码过程中的潜在造假行为，保护分销数据的真实性。

#### 核心宽表 `m1_scan_bar_code`

以 **2025-12-04 系统上线** 为分界线，合并前后两段数据：

```
上线前: qrcode_all_boxcode_detail JOIN tracking_df
上线后: m1_scan_task_mapping_record (M1SCAN, create_time > 12.4)
  ↓ LEFT JOIN itr_code_result → 箱码→托盘号映射
  ↓ LEFT JOIN poc_master_daily_fact → 售点经纬度/渠道/BU
  → 输出 m1_scan_bar_code
```

#### 六大检测维度

| 维度 | 检测方法 | 欺诈指标 |
|------|---------|---------|
| **跨店重复扫码** | 同一 box_code 被 ≥2 个业代在不同 POC 扫描 | `ACROSS_STORES_DUPLICATE` |
| **群体共享矩阵** | 36 人黑名单的箱码共现网络分析，构建 emp×emp 共享矩阵 | 共享箱码数 + 共同售点数（尤其跨 BU） |
| **GPS 速度异常** | Haversine 距离 / 相邻扫码时间差 > 40km/h | `fraud_detect = 1` |
| **扫码 vs 订单匹配** | M1 扫码成功但 BEES 系统无对应订单 | `m1_bees_match + m2_bees_match + m3_bees_match = 0` |
| **托盘号完整性** | 五个维度逐项排查（见下表） | 见下方 |
| **ML QR 码识别** | 算法模型判断二维码图片真伪（Paulo 0515 需求） | `if_validation_success = 'N'` → fraud |

#### 托盘号五维度排查

| 问题 | 发现 |
|------|------|
| ① 托盘号与箱码是否 1:1 | 存在一对多 |
| ② box_code 无对应 barcode | 存在成功扫码但无托盘号 |
| ③ 托盘号跨 BU/渠道 | 存在跨 BU 共享 |
| ④ 托盘号对应售点数 | 极端 outlier > 100 家 |
| ⑤ 一个业代扫了整个托盘 | `箱数比例` 接近 1:1 的异常集中 |

#### 造假率汇总

| BU | 造假扫描数 | 造假售点数 | 造假率 |
|----|:------:|:------:|:------:|
| 按 BU 汇总 | `fraud_scan_count` | `fraud_poc_count` | `fraud_rate` |

---

### 2.3 Distribution Output — 售点排序引擎（ETL）

#### 模块 1：SKU 特征工程

**SKU 生命周期标签**（4 个月窗口 + 历史标记）：

| 类型 | 定义 | 得分 |
|------|------|:--:|
| stable | t-3, t-2, t-1 连续出现 | 3.0 |
| unstable-high | 4 个月出现 3 次 | 2.5 |
| unstable-low | 4 个月出现 1-2 次 | 2.0 |
| churn | 仅 t-1 出现 + 历史有过（回流品） | 1.0 |
| new / inactive | 新品或无活跃 | 0 |

**热卖分数**（area × channel 维度）：

```
hot_sale_score = 0.4 × PERCENT_RANK(distribution_cnt)
               + 0.3 × PERCENT_RANK(covered_pocs)
               + 0.3 × PERCENT_RANK(active_months)
```

**协同过滤分数**：

基于 Item-Based CF，POC 内取 Top-95% SKU → area×channel 内 Cosine 相似度 → 加权求和 → PERCENT_RANK 归一化。

**组合排序分**：`rank_score = 0.5 × hot_sale_score + 0.5 × cf_score`

#### 模块 2：售点排序

```
poc_achieve_ratio = 1 - remain_kpi / total_kpi
poc_score = 0.5 × poc_achieve_ratio + 0.5 × avg(sku_score)
→ 按 M1 业代分组排序 → 每日快照表
```

#### 模块 3：每日快照

写入 `m1_poc_rank_daily_snapshot`（按 snapshot_date + yearmonth 分区），用于追踪排序效果的每日变化。

---

### 2.4 Distribution Analysis — 数据质量探查 & 售点画像

#### 三个核心问题

| 问题 | 发现 |
|------|------|
| summary 表与 KPI 系统达成数不一致 | `abs(actualvalue - succuss_poc_count)` 存在差异 |
| actualvalue 有小数 | 离散的售点个数指标出现小数点（如 12.5） |
| actualvalue 达到 9000-10000 | 一个业代一月达成近万家售点，需确认是否合理 |

#### 售点画像标签体系

**SKU 维度 `sku_tier`**：Stable / Moderate (High/Low SKU Count) / Unstable (High/Low SKU Count)

**销量维度**（按 channel 内 percentile 分档）：

| 档位 | 范围 |
|------|------|
| 5% | ≤ P5 |
| 5-20% | P5 ~ P20 |
| 20-50% | P20 ~ P50 |
| 50-100% | > P50 |

**售点分类**（按 SKU 生命周期占比）：

| 类型 | 规则 |
|------|------|
| stable | stable_pct > 50% |
| unstable | unstable_pct > 50% |
| churn | churn_pct > 50% |
| balance | 三类混合 |
| undecided | 其他 |

---

## 三、Notebook 依赖关系

```
m1_fraud_需求夏老师 ──── 需求探索，构建 m1_scan_bar_code 雏形
        │
        ▼
M1_Fraud ───────────── 完整的造假检测分析（托盘/GPS/订单/群体）
        │
        ├──▶ M1 Fraud 报告 ── 按月×BU 汇总造假指标
        │
        └──▶ M1 fraud 扫码 ── ML QR 码真伪识别（0515 Paulo 需求）

Distribution Output ──── ETL 引擎：特征工程 + 售点排序
        │
        ├──▶ MHA_achievement_analysis ── 使用产出表做达成分析
        │
        └──▶ Distribution Analysis ── 数据质量验证 + 售点画像
```

---

## 四、关键外部依赖

| 外部表 | Schema | 用途 |
|--------|--------|------|
| `m1_scan_visit_base` | `techsales_db` | 售点-业代-渠道基础维度 |
| `report_import_mapping_sku` | `bcc_dmdsrintegrationproject_ods` | SAP SKU 主数据（CIO Code→品牌+包装） |
| `poc_master_daily_fact` | `poc_datahub_dw` | 售点经纬度/渠道/BU/高德地址 |
| `employee_relation_m1m2m3_monthly` | `org_datahub_dw` | M1/M2/M3 人员管理层级 |
| `itr_brewdat_itr_code_result` | `slv_apc_sales_itr_brewdat` | 箱码→托盘号映射 |
| `tsvc_base_sys_kpiachieverate` | `md_exchange_brewdat_ods` | KPI725 达成率上报数据 |
| `qrcode_all_boxcode_detail` | `qrcode_dash_dmt` | 全量二维码扫描明细库 |

---

## 五、业务流程反推

基于以上数据资产和分析体系，反推出以下完整的业务运作流程。

### 5.1 组织架构

```
BU (事业部)
 └── Region (大区)
      └── Area (区域)
           └── Territory (片区)
                ├── M3 (经理) ── 管理多个 M2
                │    └── M2 (主管) ── 管理多个 M1
                │         └── M1 (一线业代) ── 负责若干售点
                │
                └── POC (售点/门店)
                     ├── 按业态: 大卖场/普通超市/高端超市/现购自运/
                     │          普通便利店/高端便利店/油站便利店
                     └── 按渠道: TT(传统)/KA(重点客户)/CR(餐饮)/NL(夜店)/MT(现代)
```

### 5.2 销售工作 — M1 一线业代日常执行流程

```
┌──────────────────────────────────────────────────────────────────┐
│                    月度开始                                        │
│  M1 收到当月:                                                      │
│  · 拜访路线 (POC 清单 + 拜访频次)                                  │
│  · MHA 品项清单 (该渠道/业态需覆盖的 SKU Group)                     │
│  · KPI 目标 (KPI725: 需达成的售点数量)                             │
└────────────────────┬─────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                  【每日拜访执行】                                    │
│                                                                    │
│  ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌─────────────┐  │
│  │ Step 1  │───▶│  Step 2  │───▶│  Step 3  │───▶│   Step 4    │  │
│  │ 到店    │    │ MHA 检查 │    │  扫码举证 │    │  反馈/下单   │  │
│  └─────────┘    └──────────┘    └──────────┘    └─────────────┘  │
│                                                                    │
│  Step 1 - 到店签到:                                                │
│  · App GPS 定位记录经纬度                                          │
│  · 生成 visit_id, task_status=0 (进行中)                           │
│                                                                    │
│  Step 2 - MHA 品项检查:                                            │
│  · 对照 MHA 清单检查店内是否有必售品项                              │
│  · 每个 Group 对应一个 target_id (任务×SKU 配置)                    │
│  · 分为有箱码品项 (if_has_box_code=1) 和无箱码品项                  │
│                                                                    │
│  Step 3 - 扫码举证:                                                │
│  · MHA 模块扫码: 找到对应产品箱体 → 扫描箱码 (box_code)             │
│  · 自由扫码模块: 可额外扫描非 MHA 品项                              │
│  · 系统实时校验: 箱码是否有效/是否为 ABI 码/是否匹配 Group          │
│  · 扫码成功 → if_scan_success=1, task_status=1 (完成)              │
│  · task_record 记录每次扫码行为                                     │
│                                                                    │
│  Step 4 - 反馈与下单:                                              │
│  · 若品项缺失, 选择原因:                                            │
│    - sku_not_distributed (品项未分销)                               │
│    - no_full_box (无整箱)                                          │
│    - box_code_invalid (箱码无效)                                    │
│    - box_code_damaged (箱码破损)                                    │
│    - no_box_code (无箱码)                                           │
│  · 可通过 BEES 平台帮助售点下单补货                                 │
│  · BEES 订单自动记录为 bees_distribution_detail                     │
└────────────────────┬─────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│  【系统自动判定 - MHA 达成】                                        │
│                                                                    │
│  当日/当月汇总每个售点的 MHA Group 覆盖情况:                        │
│  · 仅统计 scan_status='valid' 的有效扫码                           │
│  · 按业态分级判定是否「整体达成」:                                  │
│    - 大卖场/超市/C&C/高端超市: ≥5 个 Group 均达成 → 达成            │
│    - 便利店/油站便利店: ≥4 个 Group 均达成 → 达成                   │
│    - 通用: 所有配置 Group 均达成 → 达成                             │
│  · 记录 achieve_date (首次达成日期)                                │
│  · 将达成信息写入 distribution_achievement_detail + summary         │
└──────────────────────────────────────────────────────────────────┘
```

### 5.3 销售管理工作 — M2/M3 管理层工作流程

```
┌──────────────────────────────────────────────────────────────────┐
│                 【事前规划 - 月度初】                                │
│                                                                    │
│  ┌─────────────────┐   ┌──────────────────┐  ┌────────────────┐  │
│  │ 1. 路线分配      │   │ 2. MHA 品项配置   │  │ 3. 目标设定     │  │
│  └─────────────────┘   └──────────────────┘  └────────────────┘  │
│                                                                    │
│  1. 路线分配 (visit_base):                                         │
│     · 为每个 M1 分配负责的售点 (poc_middle_id)                      │
│     · 定义售点业态 (format_name) 和渠道 (channel)                   │
│     · 配置拜访频次 (月度计划)                                       │
│                                                                    │
│  2. MHA 品项配置 (must_have_assortment_list):                       │
│     · 按渠道/业态设定每个 Group 的必售品项                           │
│     · 每个品项有两个标识维度:                                       │
│       - Subbrand*PACK (品牌×包装, 如 Budweiser*CAN 500ml)          │
│       - CIO (CIO Code|条码, 如 6901234567890|...)                  │
│     · 标注品项是否有箱码 (if_has_box_code)                          │
│                                                                    │
│  3. 目标设定 (KPI725):                                             │
│     · 为每个 M1 设定月度 MHA 达成售点数目标 (targetvalue)            │
│     · 上报到 KPI 系统 (tsvc_base_sys_kpiachieverate)               │
│     · 目标值基于历史达成 + 售点数量 + 增长要求综合确定              │
└──────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                 【事中监控 - 每日/每周】                              │
│                                                                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │ 4. 达成进度追踪   │  │ 5. 造假风控稽核   │  │ 6. 行动推送    │   │
│  └──────────────────┘  └──────────────────┘  └───────────────┘   │
│                                                                    │
│  4. 达成进度追踪:                                                   │
│     · 实时查看 M1 × 售点的 MHA 达成状态                             │
│     · BEESForce 运营看板:                                           │
│       - distribution_progress: 各 M1/售点的分销进度                  │
│       - not_achieved_poc: 未达成售点清单                            │
│     · 达成率计算: achieved_poc / total_poc by M1                    │
│                                                                    │
│  5. 造假风控稽核 (六大维度):                                        │
│     · 跨店重复扫码: 系统自动拦截 (ACROSS_STORES_DUPLICATE)         │
│     · GPS 速度异常: >40km/h 标记 fraud_detect                       │
│     · 箱码共享网络: 识别群体造假模式                                │
│     · 扫码-订单匹配: 扫码有但 BEES 无订单 = 可疑                     │
│     · 托盘号异常: 跨 BU/跨渠道/售点过多                              │
│     · ML 图像识别: QR 码照片真伪判断                                 │
│     → 识别出高风险业代和售点, 启动调查                               │
│                                                                    │
│  6. 行动推送:                                                       │
│     · 售点排序引擎每日计算优先级:                                    │
│       poc_score = 0.5×达成差距 + 0.5×推荐SKU得分                    │
│     · 推送高优先级未达成售点清单给 M1/BEESForce                      │
│     · 推荐每售点最适合补货的 SKU (基于生命周期+热卖+协同过滤)        │
└──────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                 【事后评估 - 月度末】                                 │
│                                                                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │ 7. 绩效评估       │  │ 8. 售点画像更新   │  │ 9. 策略迭代    │   │
│  └──────────────────┘  └──────────────────┘  └───────────────┘   │
│                                                                    │
│  7. 绩效评估:                                                       │
│     · M1 达成率 = actualvalue / targetvalue                        │
│     · 双轨校验: m1_scan 系统 vs KPI 上报系统 对账                   │
│     · 识别达成率异常 (0 / 小数 / 过高如 9000+)                      │
│     · 按 BU×Region×Area 层层下钻分析                                │
│                                                                    │
│  8. 售点画像更新:                                                   │
│     · SKU 生命周期分类: stable / unstable-high / unstable-low      │
│                          / churn / new / inactive                   │
│     · 售点类型标签: stable >50% → 稳定型                            │
│                    unstable >50% → 波动型                           │
│                    churn >50% → 流失回流型                          │
│     · 销量分层: BEES 订单量 + Thomas 销量估算                       │
│     · 形成 channel × sku_tier × volume_tier 三维画像               │
│                                                                    │
│  9. 策略迭代:                                                       │
│     · 根据售点画像调整 MHA 品项配置                                 │
│     · 优化 M1 路线分配 (稳定型售点降低频次, 波动型加大投入)          │
│     · 调整 KPI 目标值                                               │
│     · 回溯造假案例 → 更新风控规则                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 5.4 核心业务闭环

```
          ┌──────────────────────────────────────────┐
          │                                          │
          ▼                                          │
    ┌──────────┐    ┌──────────┐    ┌──────────┐    │
    │  事前规划  │───▶│  现场执行  │───▶│  系统判定  │    │
    │ (管理层)  │    │  (M1)    │    │ (自动)    │    │
    └──────────┘    └──────────┘    └──────────┘    │
          ▲                               │          │
          │                               ▼          │
          │                         ┌──────────┐    │
          │                         │  事中监控  │    │
          │                         │ (管理层)  │    │
          │                         └──────────┘    │
          │                               │          │
          │                               ▼          │
          │                         ┌──────────┐    │
          └─────────────────────────│  事后评估  │────┘
                                    │ (管理层)  │
                                    └──────────┘
```

### 5.5 三条数据链路对应三条业务流程

| 数据链路 | 业务含义 | 数据表 |
|---------|---------|--------|
| **扫码链路** | M1 现场扫码举证 | `scan_detail` → `record_all` → `task_mapping_record` |
| **订单链路** | BEES 平台下单补货 | `bees_distribution_detail` → 与扫码结果交叉验证 |
| **KBD 链路** | KA 渠道关键品牌铺货 | `kbd_detail` → 仅适用于 KA 渠道 (2026-02 起) |

---

## 六、技术环境信息

| 配置项 | 值 |
|--------|-----|
| Databricks Host | `https://adb-960767945362324.0.databricks.azure.cn` |
| Cluster ID | `1021-020841-thvbkra7` |
| Workspace 目录 | `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution` |
| 输入 Schema | `gld_apc_sales_m1_scan_dw`, `techsales_db`, `bcc_dmdsrintegrationproject_ods` |

### 完整输入表清单

| 表 | Schema |
|----|--------|
| `m1_scan_distribution_achievement_detail` | `gld_apc_sales_m1_scan_dw` |
| `m1_scan_distribution_achievement_summary` | `gld_apc_sales_m1_scan_dw` |
| `m1_scan_scan_detail` | `gld_apc_sales_m1_scan_dw` |
| `m1_scan_bees_distribution_detail` | `gld_apc_sales_m1_scan_dw` |
| `m1_scan_kbd_detail` | `gld_apc_sales_m1_scan_dw` |
| `report_import_mapping_sku` | `bcc_dmdsrintegrationproject_ods` |

### Notebook 文件清单

| Notebook | 路径 |
|----------|------|
| MHA_achievement_analysis | `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution/MHA_achievement_analysis` |
| M1_Fraud | `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution/M1_Fraud` |
| M1 Fraud 报告 | `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution/M1 Fraud 报告` |
| M1 fraud 扫码 | `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution/M1 fraud 扫码` |
| m1_fraud_需求夏老师 | `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution/m1_fraud_需求夏老师` |
| Distribution Output | `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution/Distribution output` |
| Distribution_analysis | `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution/Distribution_analysis` |
| BUS售点清单 | `/Workspace/Users/sabrina.yu@budweiserapac.com/Distribution/BUS售点清单` |
