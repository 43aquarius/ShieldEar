/**
 * 声盾技术报告 — 正文内容 第三部分（第六至九章 + 参考文献 + 附录）· v1.3.12 口径
 */

const { h1, h2, h3, p, run, note, figTitle, tabTitle, table, figure } = require("./builders.cjs");

function chapter6() {
  return [
    h1("第六章  创新点总结"),
    h2("6.1 从离线检测到通话级实时流式鉴伪"),
    p("领域综述指出，现有音频深伪检测研究的主流形态仍是整段离线推理[14]，而反诈实战的最小时间单元是「一通正在进行的电话」。声盾将问题前移到通话进行时：滑动窗口流式管线使检测与通话同步推进，逐窗判决在数据采集完成后的1秒内给出，高置信片段即时触发告警而非事后追溯。对诈骗场景而言，提前一分钟的告警可能直接阻断一笔转账，实时性由此从工程指标升维为业务价值。RTF实测均值0.007且纯CPU运行，使该能力可部署于普通终端而非GPU服务器——对照VoiceWukong基准揭示的真实场景性能落差[4]，轻量路线在端侧部署维度上具有不可替代性。"),
    h2("6.2 可解释轻量引擎：单类先验校准与数据驱动的特征筛选"),
    p("不同于端到端黑盒判决，声盾的每一个判决都可展开为十一维特征相对同信道自然先验的标准化偏离，逐窗明细、特征剖面与评分权重全部留痕并可被第三方复算——这是反诈取证对可审计性的刚性要求。方法论上，作品的先验校准设计与单类学习「仅建模自然类、以偏离度检测未知攻击」的思想同构[8]，但以逐特征z偏离的线性组合替代深度表征，把该思想的可解释性推到极限；同时以「同口径探针实证」的筛选流程约束特征集的每一次扩张——v2.0升级中九个候选形态因分离不足被如实排除并留档（见4.7节），这种「负结果也是交付物」的做法，与领域内以消融实验支撑主张的规范一致。校准全流程脚本化，随样本扩展可一键重拟合，使引擎成为可持续演化的框架而非一次性的参数集合。"),
    h2("6.3 反诈业务闭环：检测、告警、存证、报告"),
    p("声盾把「检测工具」升级为「反诈材料生产线」：判决输出直接对接四级风险处置建议、可疑片段时间轴定位、SHA-256哈希固定的证据链、案件编号管理的案例库、八章节结构可导出PDF的核验报告，以及SHA-256清单自洽的离线存证包。对一线反诈场景，这意味着检测结论无须二次加工即可进入举报与协查流程；对工具自身，这意味着每个判决都有完整的证据链背书，可回溯、可复核、可质证。该闭环在纯离线条件下经断网netns全功能回归验证，构成「检测—验真」两端齐全的完整链路。"),
    h2("6.4 双端一致性存证架构"),
    p("浏览器与服务端运行同一份同构TypeScript引擎，客户端实时初判、服务端复核存证、两端结果可互相验证。该架构同时解决了三个问题：实时性要求下的本地计算、取证可信度要求下的服务端背书、以及两端判决一致性要求下的代码同源。配合证据音频与原始来源的双哈希锚定，用户看到的每一个判决都对应一条可独立复算的证据链路。"),
  ];
}

function chapter7() {
  return [
    h1("第七章  应用前景与社会价值"),
    h2("7.1 面向公众的反诈验真入口"),
    p("作品的直接受益场景是普通用户的通话验真：接到自称亲友的转账请求时，开启声盾即可获得实时风险提示与可固定证据。适老化是天然延展方向——老年群体是AI语音诈骗的高受害人群，也是「听声辨人」信任模式最强的群体，声盾的告警与报告可设计为大字号、高对比、语音播报形态，由子女为父母预装配置。所有演示与文档均强调工具定位为辅助验真而非执法结论，避免绝对化表述带来的误用风险。"),
    h2("7.2 面向机构的风控与协查组件"),
    p("对银行与支付机构，声盾可作为电话渠道大额转账的附加风控信号：客服或自助流程中提示用户开启验真，高风险通话触发人工复核或延迟到账。对反诈中心与基层派出所，核验报告的哈希证据链与案件编号体系可作为群众举报材料的标准化载体，降低线索登记与核验成本。对内容平台，引擎的流式形态可嵌入语音弹幕、语音评论的实时审核管线。平台全部服务端组件化，API按独立资源组织，具备被上述系统集成的工程条件。"),
    h2("7.3 政策呼应与治理价值"),
    p("作品与两项施行的法规直接同频：《反电信网络诈骗法》确立的全民反诈框架需要普惠型验真工具落地，《互联网信息服务深度合成管理规定》要求的深度合成内容治理需要可审计的检测手段。声盾把两部法规的共同诉求——让普通人有能力辨别合成内容——转化为一个可运行的工程答案，其证据链设计也为后续涉诈案件中电子材料的规范化提供了实践参考。"),
  ];
}

function chapter8() {
  return [
    h1("第八章  开发历程与后续计划"),
    h2("8.1 已完成的开发历程"),
    p("作品按照「先引擎、后平台、再闭环、复归引擎」的次序推进。第一阶段完成引擎核心与数据驱动校准：DSP基础库、八维特征提取、流式分析器、样本构造与逻辑回归拟合。第二阶段完成平台与业务闭环：五层架构搭建、采集入口、存证与案例库、核验报告导出。第三阶段完成发行工程化：纯离线便携包、断网netns全功能回归、版本化专项回归体系。第四阶段（当前，v1.3.11至v1.3.12）完成两件事：其一，按产品诚实原则移除了实测音质不达标的本地语音合成演示模块，平台聚焦「检测、存证、核验」主线；其二，完成引擎v2.0学术增强——参照文献结论扩展韵律特征集并以探针实证筛选，修复窄带信道判定潜伏缺陷，测试套件引入EER/AUC学术口径，258条判决整体正确率由上一入库基线的209/258提升至226/258。当前平台处于可完整演示状态，全部代码与校准脚本随作品提交。"),
    h2("8.2 后续十二周深化计划"),
    tabTitle("表 8-1  十二周深化计划"),
    table(
      ["周次", "任务", "交付物"],
      [
        ["第1-2周", "校准集扩充：接入开源声码器家族（VITS/HiFi-GAN）样本与多说话人自然语料，重拟合先验与权重", "扩充版校准集与权重，相位/倒谱特征重评估"],
        ["第3-4周", "AASIST基线复现：按官方流程在ASVspoof 2019 LA训练与评测", "基线EER与论文同量级，工程正确性锚点"],
        ["第5-7周", "RawGAT-ST训练与双网络软投票融合，含消融实验", "集成模型与消融表"],
        ["第8-9周", "ONNX动态量化、CPU并发推理优化、蒸馏兜底方案", "RTF小于1的轻量推理服务"],
        ["第10周", "流式管线对接深度引擎，置信度校准与告警阈值回归测试；ASVspoof 2021 LA与自建窄带子集跨信道评测、Rawboost增强调参", "深度引擎版实时服务与跨信道鲁棒性数据"],
        ["第11周", "整体联调、演示脚本排练、测试数据准备", "答辩演示彩排"],
        ["第12周", "技术报告、演示视频与全部答辩材料定稿", "完整参赛材料"],
      ],
      [14, 56, 30],
      { boldCol0: true, zebra: true }
    ),
    h2("8.3 团队分工"),
    p("本团队由两名成员组成（队伍「你们说的对」，大连理工大学），按「引擎与平台—评测与文档」双主线分工、关键节点互为复核。队长43aquarius负责引擎与平台主线：十一维声学特征设计与探针筛选、数据驱动校准与窄带权重组拟合、流式滑动窗口管线、Web架构与双端存证链路实现；队员谭畅负责评测与文档主线：测试集构造与鲁棒性变体设计、三层口径基准评测与EER/AUC指标落地、端到端功能验证，以及技术报告、测试报告与答辩材料的撰写定稿。两条主线在特征取舍、阈值标定与报告结论三处交叉评审，确保「实现的功能被测到、测到的结论写得准」；开源仓库的提交历史与此分工一一对应，可逐条查验。"),
  ];
}

function chapter9() {
  return [
    h1("第九章  总结与展望"),
    p("本作品以可查证的获奖作品实证为校准，选择了AI语音鉴伪这一社会痛点明确、政策支点清晰、开源底座充分的方向，并以单点深挖的方式完成了从方案到可运行系统的完整落地。当前阶段的贡献可概括为三条主线：技术上，构建了十一维可解释特征与数据驱动校准的ShieldEar轻量引擎（v2.0.0-calibrated），宽带合成检出20/20、258判决整体正确率87.6%、综合EER 0.18、RTF实测均值0.007，并修复了窄带信道判定的潜伏缺陷；工程上，落地了实时流式检测、双端一致性存证与反诈业务闭环的单页平台，以纯离线便携包形态发行并经断网实测验证；方法上，确立了「同口径探针实证、负结果留档」的特征筛选流程与「三层评测口径」的诚实呈现框架。"),
    p("下一阶段的主线是深度引擎集成与校准集扩充：AASIST与RawGAT-ST双网络在ASVspoof 2019 LA复现EER锚点，ONNX量化实现CPU实时，2021 LA与自建窄带子集完成跨信道评测，开源声码器家族样本纳入后重评估相位与倒谱特征的入选资格，使作品在权威基准的硬指标、跨信道鲁棒性与可解释业务闭环三个维度同时具备竞赛级完成度。更远处，声盾架构对实时内容安全检测具有一般性——滑动窗口流式管线、双端一致性、证据链闭环的组合同样适用于实时视频鉴伪与直播内容风控，这为作品留出了从单点作品走向工具族的演化空间。"),
  ];
}

function referencesSection() {
  const refs = [
    "LIU X, WANG X, SAHIDULLAH M, et al. ASVspoof 2021: towards spoofed and deepfake speech detection in the wild[J]. IEEE/ACM Transactions on Audio, Speech, and Language Processing, 2023, 31: 2507-2522.",
    "WANG X, DELGADO H, TAK H, et al. ASVspoof 5: design, collection and validation of resources for spoofing, deepfake, and adversarial attack detection using crowdsourced speech[EB/OL]. (2025-02-13)[2026-11-09]. https://arxiv.org/abs/2502.08857.",
    "YI J, TAO J, FU R, et al. ADD 2023: the second audio deepfake detection challenge[EB/OL]. (2023-05-23)[2026-11-09]. https://arxiv.org/abs/2305.13774.",
    "YAN Z, ZHAO Y, WANG H. VoiceWukong: benchmarking deepfake voice detection[C]//Proceedings of the 34th USENIX Security Symposium. Berkeley: USENIX Association, 2025.",
    "TODISCO M, DELGADO H, EVANS N. Constant Q cepstral coefficients: a spoofing countermeasure for automatic speaker verification[J]. Computer Speech & Language, 2017, 45: 516-535.",
    "TAK H, PATINO J, TODISCO M, et al. End-to-end anti-spoofing with RawNet2[C]//ICASSP 2021 - 2021 IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP). Piscataway: IEEE, 2021: 6369-6373.",
    "JUNG J W, HEO H S, TAK H, et al. AASIST: audio anti-spoofing using integrated spectro-temporal graph attention networks[C]//ICASSP 2022 - 2022 IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP). Piscataway: IEEE, 2022: 6367-6371.",
    "ZHANG Y, JIANG F, DUAN Z. One-class learning towards synthetic voice spoofing detection[J]. IEEE Signal Processing Letters, 2021, 28: 937-941.",
    "WANG R, JUEFEI-XU F, HUANG Y, et al. DeepSonar: towards effective and robust detection of AI-synthesized fake voices[C]//Proceedings of the 28th ACM International Conference on Multimedia. New York: ACM, 2020: 1207-1216.",
    "XIE Y, CHENG H, WANG Y, et al. Domain generalization via aggregation and separation for audio deepfake detection[J]. IEEE Transactions on Information Forensics and Security, 2024, 19: 344-358.",
    "ZHANG Y, ZHU G, JIANG F, et al. An empirical study on channel effects for synthetic voice spoofing countermeasure systems[C]//Proceedings of Interspeech 2021. Grenoble: ISCA, 2021: 4309-4313.",
    "CARLINI N, WAGNER D. Audio adversarial examples: targeted attacks on speech-to-text[C]//2018 IEEE Security and Privacy Workshops (SPW). Piscataway: IEEE, 2018: 1-7.",
    "ZONG W, CHOW Y W, SUSILO W, et al. AudioMarkNet: audio watermarking for deepfake speech detection[C]//Proceedings of the 34th USENIX Security Symposium. Berkeley: USENIX Association, 2025.",
    "YI J, WANG C, TAO J, et al. Audio deepfake detection: a survey[EB/OL]. (2023-08-29)[2026-11-09]. https://arxiv.org/abs/2308.14970.",
    "ZHANG B, CUI H, NGUYEN V, et al. Audio deepfake detection: what has been achieved and what has yet to be addressed[J]. Sensors, 2025, 25(7): 1989.",
  ];
  return [
    h1("参考文献"),
    p("（按正文首次引用顺序编号，著录格式遵循GB/T 7714-2015）"),
    ...refs.map((r, i) => new (require("docx").Paragraph)({
      spacing: { after: 80, line: 300 },
      indent: { left: 480, hanging: 480 },
      children: [new (require("docx").TextRun)({
        text: `[${i + 1}] ${r}`,
        size: 21, font: { ascii: "Times New Roman", eastAsia: "SimSun" },
      })],
    })),
  ];
}

function appendix() {
  return [
    h1("附录A  平台界面"),
    ...figure("shield_home.png", 560, "图 A-1  检测工作台首页：实时鉴听与文件检测双模式入口与演示动线提示"),
    ...figure("shield_result.png", 430, "图 A-2  检测结果视图：判决卡、逐窗置信度曲线、可疑片段时间轴、可解释特征剖面、逐窗明细与证据哈希链"),
    ...figure("shield_tech.png", 430, "图 A-3  平台内建技术方案视图：五层架构、特征表、校准方法论与升级路线"),
    h1("附录B  开源组件映射表"),
    tabTitle("表 B-1  开源底座与自研增量对照"),
    table(
      ["组件", "复用的开源项目", "自研增量"],
      [
        ["检测引擎", "无（纯自研，零依赖TypeScript实现）", "十一维特征、流式滑窗、校准框架、窄带自适应"],
        ["校准合成样本", "z-ai平台TTS（授权生成7音色×3文本）", "16kHz标准化、窄带退化构造与校准集组装"],
        ["演示自然人声", "MDN webaudio-examples、wavesurfer.js公开音频（公有领域）", "16kHz标准化与校准集构造"],
        ["前端框架", "Next.js 16、React 19、Tailwind CSS 4、shadcn/ui、recharts", "全部业务界面与交互流程"],
        ["数据层", "Prisma、SQLite", "案例与证据链数据模型"],
        ["深度引擎路线", "clovaai/aasist、asvspoof-challenge、Rawboost、ONNX Runtime（计划接入）", "双网络融合接口与评测方案"],
      ],
      [16, 46, 38],
      { boldCol0: true, zebra: true }
    ),
    note("注：本作品的核心检测引擎、校准与评测脚本、平台全部业务代码均为团队自研；计划接入的开源深度模型仅处于既定路线阶段，未包含在当前提交中。源码、文档与测试数据完整托管于 github.com/43aquarius/ShieldEar，随作品一并提交免安装可执行程序包，包内代码与仓库主干一致，可对照复核。"),
  ];
}

module.exports = { chapter6, chapter7, chapter8, chapter9, referencesSection, appendix };
