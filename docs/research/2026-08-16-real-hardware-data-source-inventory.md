---
title: 真实硬件数据源盘点
date: 2026-08-16
scope: Arduino UNO R3、ESP32-S3、RP2040/Pico、NUCLEO-F401RE、Arduino CLI、KiCad CLI ERC、Wokwi CLI/automation、DHT22、SSD1306/OLED、BMP280、SG90、继电器
source_policy: 仅使用芯片厂商、板卡厂商、工具项目官方资料或官方仓库
---

# 真实硬件数据源盘点

## 结论摘要

这份盘点回答的是“哪些事实可以安全地作为产品数据源”，不是对当前代码进行修复。当前仓库的组件目录和平台目录可以作为产品草稿，但不能直接当作硬件真值：其中存在芯片、模块、开发板混用，且若干器件只有营销名称，没有制造商和精确料号。

- Arduino UNO R3、NUCLEO-F401RE 和 Raspberry Pi Pico 有清晰的官方板卡资料，可直接导入板卡级身份、接口、供电、存储和工具链入口。
- ESP32-S3 必须先区分芯片、WROOM 模组、具体 DevKit 或自定义板；芯片和模组资料不能推出某一块开发板的实际引脚暴露、Flash/PSRAM SKU 或 USB/Strapping 占用。
- RP2040 是芯片，Pico 是带外部 Flash 和 26 个用户 GPIO 的板；当前仓库的 `RP2040` 条目实际混入了 Pico 板级字段。
- Arduino CLI 可以编译、上传，并在上传后校验；当前 1.3 命令参考没有独立的顶层 `arduino-cli verify` 命令。编译成功不是实物烧录成功，`--verify` 也只在实际上传流程之后有意义。
- KiCad CLI 的 `sch erc` 可以产生 ERC 报告和违规退出码，但 ERC 是原理图规则证据，不能证明真实电压、电流、接线、负载或装配结果。
- Wokwi CLI 的命令客户端可在本地运行，仿真/CI 执行边界在云端；自动化场景当前官方标为 alpha。仿真通过不能升级为真实硬件通过。商业私有项目、私有 IoT gateway 和商业 CI 分钟数受套餐限制。
- DHT22/AM2302 和 SSD1306/OLED 的官方入口当前主要提供产品页/索取数据手册，而不是足以覆盖模块级电气细节的公开文件。应先落制造商、型号和来源状态，不能用常见模块经验值填空。
- BMP280 和 SG90 有足够明确的官方器件资料；但 BMP280 裸芯片资料不能推导某个 breakout 模块的 VIN、地址或电平转换，SG90 官方正式规格没有给出可用于 MCU 供电设计的“典型电流”。
- 泛化“继电器模块”没有唯一官方数据源。Songle SRD(T73) 只能作为“候选裸继电器系列”资料；模块输入门限、驱动器、指示灯、飞线/端子和 3.3V 兼容性必须由精确模块料号及其原理图确认。

## 口径与判定规则

1. “官方”指芯片/板卡/器件制造商官网、官方文档站、官方维护的工具项目仓库或官方产品/价格页面。未采用经销商、论坛、博客或第三方模块 PDF 作为事实依据。
2. 每个事实在下文用来源编号标记；文末“官方来源登记”给出直接 URL、文档版本/更新时间（若页面没有标注则明确写“未标注”）和本次访问日期。
3. “可直接导入产品的数据字段”只包括来源明确写出的字段，并且要同时记录来源对象的层级：芯片、模组、开发板、裸器件、模块或工具版本。
4. “不能据此推断的字段”包括任何需要具体 SKU、实测、模块原理图、装配信息、板级布局或现场命令结果才能确定的内容。
5. 本文的“访问日期”是 2026-08-16。网页内容会继续变化；产品应保存来源 URL、文档版本/日期和抓取时间，而不是只保存一个数值。

## 仓库当前目录盘点

盘点对象：`C:/codex/mcu-project-assistant/src/domain/knowledge/platforms.ts` 和 `C:/codex/mcu-project-assistant/src/domain/knowledge/components.ts`。这些是仓库内部现状，不是外部一手资料；这里仅用于对照，不把它们当作硬件证据。

| 当前条目 | 当前目录中的身份/字段 | 与官方数据源的主要风险 |
|---|---|---|
| `arduino_uno` | UNO、5 V、32/2/1 KB、D0-D13、A0-A5、FQBN `arduino:avr:uno` | 大体对应 UNO R3，但 `reservedPins`、可用 3.3 V 电流和运行时端口仍应以官方板卡资料及现场检测为证据。 |
| `ESP32-S3` | 显示为 `ESP32-S3 WROOM-1`，包含 8 MB Flash、512 KB SRAM、45 GPIO、USB 和若干 IO 映射 | 混合了芯片、模组和可能的 DevKit 级字段；WROOM SKU 和具体开发板不能互换。 |
| `RP2040` | 显示 Raspberry Pi RP2040，含 2 MB Flash、26 GPIO、30 GPIO/4 ADC 等字段 | 2 MB Flash 和 26 个用户 GPIO 是 Pico 板级事实，不是 RP2040 芯片通用事实。 |
| `STM32F401RE` | Nucleo F401RE、512/96 KB、3.3 V、Arduino 头引脚；工具链 core 标为 `stm32duino:STM32F1` | 官方对象是 STM32F4 系列 MCU 和 NUCLEO-F401RE 板；当前 `F1` core 标记与官方 STM32F401RE 支持信息冲突，应由已安装包和实际 FQBN 重新解析。 |
| `DHT22` / `AM2302` | 3.3-5.5 V、2.5 mA、仅 UNO | 当前官方 AM2302 产品页未在公开页面给出这些完整字段，不能把常见模块参数当作已证实资料。 |
| `BMP280` | 1.71-3.6 V、2.7 mA、I2C | 裸芯片电源和接口不能推出 breakout 模块的 5 V 容忍、地址、上拉和连接器。 |
| `SSD1306/OLED` | 0.96 inch、3.3-5 V、20 mA、I2C | 官方 SSD1306 资料确认的是控制器能力，不是任一“0.96 inch 模块”的面板、地址、接线或电流。 |
| `SG90` | 4.8-6.0 V、250 mA、PWM | Tower Pro 正式页面给出 4.8 V 的扭矩/速度等机械规格，但没有支撑 `typicalCurrentMa:250` 的正式测试条件；舵机应外部供电。 |
| `继电器模块` | 5 V、70 mA、数字输出、要求续流二极管 | 没有制造商或料号；裸继电器系列数据不能证明该模块的驱动拓扑、输入门限、线圈电流或安全间距。 |

## 板卡与芯片官方数据源

### Arduino UNO R3

| 事实 | 可直接导入产品的数据字段 | 不能据此推断的字段 |
|---|---|---|
| 官方产品对象是 Arduino UNO Rev3，使用 ATmega328P；工作电压 5 V，推荐输入 7-12 V，输入限制 6-20 V。[U1] | `board.manufacturer=Arduino`；`board.model=UNO Rev3`；`mcu=ATmega328P`；`logicVoltage=5V`；`recommendedInput=7-12V`；`inputLimit=6-20V`。 | 不能由推荐输入范围推出某个 USB 电源、外部电源或系统负载下的实际热裕量。 |
| 官方规格列出 14 个数字 I/O（其中 6 个 PWM）、6 个模拟输入、每个 I/O 20 mA、3.3 V 引脚 50 mA。[U1] | `digitalPinCount=14`；`pwmPinCount=6`；`analogInputCount=6`；`ioCurrentMax=20mA/pin`；`3v3PinCurrentMax=50mA`。 | 不能把 20 mA 当作推荐持续负载，也不能把所有引脚同时拉到该值；不能推断外接模块浪涌和总板级电源余量。 |
| 官方规格列出 32 KB Flash（其中 0.5 KB bootloader）、2 KB SRAM、1 KB EEPROM、16 MHz。[U1][U2] | `flash=32KB`；`bootloader=0.5KB`；`sram=2KB`；`eeprom=1KB`；`clock=16MHz`；`datasheetVersion/modified=U2`。 | 不能从容量推断应用最终可用空间、编译后静态占用或串口 bootloader 当前是否仍在板上。 |
| 官方说明可通过预装 bootloader 使用 USB/串口上传，也提供 ICSP。[U1] | `uploadPath=bootloader/ICSP`；`fqbn=arduino:avr:uno`（作为 Arduino CLI 入口，仍需以已安装核心实际解析结果为准）。 | 不能由 FQBN 推断当前连接的物理板、USB 端口、驱动状态或上传已经成功。 |

### ESP32-S3

| 事实 | 可直接导入产品的数据字段 | 不能据此推断的字段 |
|---|---|---|
| ESP32-S3 官方芯片文档列出双核 Xtensa LX7、2.4 GHz Wi-Fi、Bluetooth LE、USB OTG、USB Serial/JTAG、外设和安全功能。[E1][E3] | `mcu=ESP32-S3`；`cpu=dual Xtensa LX7`；`wifi=2.4GHz 802.11b/g/n`；`ble=5`；`usb=OTG/Serial-JTAG`；`sourceScope=chip`。 | 不能从芯片资料推断某块板是否把 USB、天线、Flash、PSRAM 或所有 GPIO 引出。 |
| ESP32-S3-WROOM-1/WROOM-1U 官方模组数据手册页面当前列为 v1.8、2026-03-02；模组资料列出 3.0-3.6 V、最多 36 个 GPIO、Flash/PSRAM 选项和温度档。[E2] | `module=ESP32-S3-WROOM-1/WROOM-1U`；`moduleDatasheetVersion=1.8`；`moduleDatasheetDate=2026-03-02`；`vdd=3.0-3.6V`；`maxModuleGpio=36`；`flash/psram=按具体 SKU`。 | 不能把“最多 36 GPIO”当作某块 DevKit 的用户可用 GPIO；不能在未确认后缀、Flash/PSRAM SKU、天线型式和温度等级时导入容量或 RF 字段。 |
| Espressif 官方 Arduino-ESP32 仓库对具体板型给出引脚/外设映射；例如 ESP32-S3 DevKitC-1 的 UART、I2C、SPI、USB、ADC 和 strapping 引脚按该板型定义。[E4] | `boardVariant`、`pinMap`、`usbPins`、`strappingPins`、`uart/i2c/spi` 只能按精确 DevKit/板型从对应官方映射导入。 | 不能把 DevKitC-1 映射复制给 WROOM-1 模组、自定义板或另一版本 DevKit；不能由 GPIO 编号推断上电默认状态、外部负载能力或无冲突复用。 |

当前仓库的 `ESP32-S3 WROOM-1`、8 MB Flash、512 KB SRAM 和“45 GPIO”需要拆成至少三个身份：芯片、模组 SKU、开发板/自定义板。若产品选择的是 ESP32-S3 DevKitC-1，应另建板型记录；若选择 WROOM-1，则必须补齐后缀和 Flash/PSRAM SKU。

### RP2040 与 Raspberry Pi Pico

| 事实 | 可直接导入产品的数据字段 | 不能据此推断的字段 |
|---|---|---|
| RP2040 官方数据手册列出双核 Arm Cortex-M0+、最高 133 MHz、264 KB 片上 SRAM、30 个 GPIO、2 UART、2 SPI、2 I2C、16 PWM、USB 1.1、8 个 PIO；芯片本身是无片上 Flash 的无状态器件。[R1] | `mcu=RP2040`；`cpu=dual Cortex-M0+`；`clockMax=133MHz`；`sram=264KB`；`chipGpio=30`；`uart=2`；`spi=2`；`i2c=2`；`pwm=16`；`pio=8`；`onChipFlash=0`。 | 不能由 RP2040 芯片资料推出外部 Flash 容量、板上 USB 连接器、板级供电、引脚排布或用户可接触的 GPIO 数。 |
| Raspberry Pi Pico 官方板级数据手册列出 2 MB 板载 Flash、26 个多功能 GPIO、1.8-3.3 V I/O、3 个用户 ADC、12-bit 500 ksps ADC、2 UART/2 I2C/2 SPI/16 PWM。[R2][R3] | `board=Raspberry Pi Pico`；`boardFlash=2MB`；`userGpio=26`；`ioVoltage=3.3V`；`userAdc=3`；`adc=12bit/500ksps`；`boardDatasheetUpdated=2026-07-15`（官方产品文档门户）。 | 不能把 Pico 的 2 MB Flash 和 26 GPIO 回填到泛化 `RP2040` 芯片；不能从芯片/板手册推出某个第三方 Pico clone 的 Flash、晶振、稳压器或引脚质量。 |
| Raspberry Pi 官方规格页给出 RP2040 产品温度范围 -40 至 85 °C，并说明产品供货规划至少到 2041 年 1 月。[R4] | `operatingTemperature=-40..85C`（对象为 RP2040 规格）；`longevity=至少至 2041-01`。 | 不能把芯片规格温度直接当作 Pico 板上所有器件的环境额定；供货规划也不等于当前库存或某个经销商交付时间。 |
| 官方 Arduino-Pico 核心仓库将板卡 ID 注册为 `rpipico`，可作为 Arduino CLI 包/核心的板级入口。[R5] | `fqbn` 的 board 字段可从已安装 Arduino-Pico 核心解析为 `rpipico`；记录核心包版本和解析日志。 | 不能只凭仓库中的字符串证明本机安装了该核心、FQBN 可编译或目标端口真的是 Pico。 |

### NUCLEO-F401RE

| 事实 | 可直接导入产品的数据字段 | 不能据此推断的字段 |
|---|---|---|
| ST 官方板卡页将 NUCLEO-F401RE 定义为 STM32 Nucleo-64，搭载 STM32F401RE，带 Arduino Uno V3 和 ST morpho 接口，并集成 ST-LINK/V2-1。[N1][N2] | `board=NUCLEO-F401RE`；`boardFamily=Nucleo-64`；`mcu=STM32F401RE`；`connectors=Arduino Uno V3/ST morpho`；`debugger=ST-LINK/V2-1`。 | 不能由 Arduino 兼容接口推断其 I/O 电平是 5 V；该板 MCU I/O 以 3.3 V 兼容为准，不能当作 UNO 的 5 V GPIO。 |
| 官方用户手册给出 USB VBUS、外部 3.3 V、外部 5 V 和 7-12 V 等板级供电路径，以及 Arduino 头的板级映射；手册明确 MCU I/O 为 3.3 V 兼容。[N3] | `ioVoltage=3.3V`；`powerInputs=USB VBUS/external 3.3V/external 5V/7-12V as documented`；`arduinoHeaderMap` 必须逐引脚导入；例如 A0=PA0、A1=PA1、A2=PA4、A3=PB0，I2C 相关 A4/A5 按手册映射。 | 不能把 A4/A5 等 Arduino 头名称直接等价成 UNO 的 MCU 引脚；不能由接口名称推断所有复用功能同时可用或外部电源路径在任意跳帽状态下都启用。 |
| STM32F401RE 官方 MCU 数据手册/产品页列出 Cortex-M4、最高 84 MHz、512 KB Flash、96 KB SRAM、12-bit 2.4 MSPS ADC 等资源。[N4] | `mcuClockMax=84MHz`；`flash=512KB`；`sram=96KB`；`adc=12bit/2.4MSPS`；`datasheet=DS10086 Rev.5, 2026-02`（官方检索页标注）。 | 不能用 MCU 资源替代板级用户可用 GPIO、ST-LINK、跳帽、电源和 Arduino 头映射；不能把“支持 F401RE”推断成当前机器安装的 Arduino core/FQBN。 |
| STM32duino 官方核心仓库列出 STM32F401RE Nucleo 支持，并提供 Board Manager 文件入口；支持表是核心项目资料，不是 ST 板卡电气手册。[N5] | `arduinoCore=STM32duino`；`supportedBoard=STM32F401RE Nucleo`；记录实际安装的核心版本和完整解析出的 FQBN。 | 不能把仓库当前的 `stm32duino:STM32F1:nucleo_f401re` 当作已核实事实；项目内部 `stm32f4` 与 `STM32F1` 标记冲突，应在运行时安装包中核对。 |

## Arduino CLI：compile / upload / verify

官方命令参考版本路径为 1.3；Arduino CLI 官方仓库在本次访问时显示最新 release v1.5.0（2026-05-19）。产品应同时保存“运行时 CLI 版本”和“引用的命令参考版本”，不能只记录命令字符串。[A1][A6]

| 能力 | 官方事实与可直接导入字段 | 不能据此推断的字段 |
|---|---|---|
| `compile` 编译草图；要求 FQBN；支持 `--output-dir`、`--build-path`、`--export-binaries`、`--libraries`、`--warnings`、`--jobs`、`--json`、`--only-compilation-database`，并可用 `--upload` 或 `--verify` 组合工作。[A2] | `command=compile`；`fqbn`；CLI/core/package/library 版本；输入草图绝对路径；构建目录/输出目录；导出 `.hex/.bin/.elf` 路径；退出码；stdout/stderr；产物 SHA-256；编译时间。 | 编译成功不能证明目标板存在、端口匹配、bootloader 可用、Flash 写入成功或外设接线正确；FQBN 不是现场板卡身份。 |
| `upload` 不会先编译草图；可以使用 FQBN、`--port`、`--programmer`、`--protocol`、`--input-dir`、`--input-file`、`--build-path`；`--verify` 在上传后验证。[A3] | `command=upload`；`fqbn`；`port`；programmer/protocol；输入产物路径和 hash；上传退出码；串口/工具日志；verify 结果；超时/取消状态。 | 不能把“命令启动”或“发现了端口”算作烧录成功；不能把旧构建目录中的二进制当作当前源码构建结果；不能从 upload 成功推断应用启动、传感器读数或负载安全。 |
| 当前 1.3 命令参考中没有独立的顶层 `arduino-cli verify` 命令；`--verify` 是 compile/upload 的选项，上传校验意味着上传流程已经执行。[A2][A3] | `verificationMode=upload-after-write`；`verifyExitCode`；原始验证日志；与本次产物关联的 `artifactHash`。 | 不能把“verify 选项可用”解释成一个独立、脱离端口和写入步骤的物理验证阶段。 |
| `board list` 可检测连接的板，并支持 JSON、发现超时、FQBN 过滤和 watch。[A4] | `discoveredBoardsJson`；检测时间；系统端口；协议/发现器；识别出的 VID/PID、序列号或 FQBN（若工具实际返回）；发现命令版本。 | 检测到端口不等于目标板可写；VID/PID 不能唯一证明板上 MCU 或当前项目对应关系；不能从一次 discovery 缓存推断后续上传仍可用。 |
| Arduino CLI 的 sketch project/profile 机制可以声明平台版本和库，帮助隔离/复现构建。[A5] | `profile`；平台包版本；库及版本；配置文件路径；解析后的依赖清单。 | 不能从 profile 声明推断机器已经联网安装成功或硬件已被实际烧录。 |

推荐作为产品证据的最小流程是：先用 `board list --json` 产生新鲜板卡发现记录，再用固定绝对路径和已核验 FQBN 编译，保存产物 hash，最后对同一产物执行 upload，并把真实退出码、未超时状态和上传后的 verify 结果写入 BuildRecord。仿真 fixture、静态命令拼装或旧端口记录不能升级为物理验证。

## KiCad CLI ERC

KiCad 官方 Windows 下载页在本次访问时列出稳定版 10.0.5；KiCad 10.0 CLI 手册标注基于 10.0.5、文档修订 `a77c36a3`。[K1][K3]

| 能力 | 官方事实与可直接导入字段 | 不能据此推断的字段 |
|---|---|---|
| 原理图 ERC 命令为 `kicad-cli sch erc`，输入为 `.kicad_sch`，支持输出 `.rpt` 或 `.json`，可设置 `--format`、`--units`、`--severity-*`、`--define-var` 和 `--severity-exclusions`。[K3] | `command=sch erc`；KiCad 版本；输入原理图绝对路径；输出路径；格式；单位；严重级别过滤；排除规则；完整报告内容。 | 不能把 ERC 输出当作芯片电气规格、板级电源预算或元件实际值；ERC 结果依赖符号引脚电气类型和项目规则。 |
| `--exit-code-violations` 在没有违规时返回 0，有违规时返回 5。[K3] | `ercExitCode`；`violationCount`；按 severity 分类的违规数；报告 hash；运行时间。 | 退出码 0 不能证明原理图一定能制造、上电、通信或通过真实负载测试；未建模的错误不会被 ERC 自动发现。 |
| KiCad CLI 官方定位是自动化原理图、PCB、符号和封装工作流。[K3] | `tool=KiCad CLI`；`automationStage=schematic ERC`；版本和命令参数；CI artifact/report 路径。 | 不能由 ERC 通过推断 PCB 已布线、DRC 已通过、装配正确、焊接可靠或真实电流/温升满足要求。 |

示例命令（不包含任何凭据）：

```text
kicad-cli sch erc --format json --output erc.json --exit-code-violations design.kicad_sch
```

## Wokwi CLI / automation：能力与云端/商业边界

| 官方事实 | 可直接导入产品的数据字段 | 不能据此推断的字段 |
|---|---|---|
| Wokwi CLI 可从终端运行仿真，使用与 VS Code 相同的 `wokwi.toml` 和 `diagram.json`；官方 CI 文档说明仿真引擎在云端运行，固件二进制上传到 CI 服务，仿真结束后删除、不保存。[W1][W3] | `simulator=Wokwi`；`diagramFile`；`wokwiToml`；固件 ELF/BIN 路径和 hash；云端运行标记；串口日志；运行时长；仿真退出码；删除/保留策略记录。 | 不能把本地 CLI 命令客户端等同于本地硬件仿真；不能把云端仿真通过当作真实 GPIO 电压、电流、信号完整性、热、EMI、USB、boot strap 或继电器负载测试通过。 |
| CLI 支持 `--elf`、`--diagram-file`、`--serial-log-file`、`--timeout`、`--timeout-exit-code`、`--expect-text`、`--fail-text`、`--scenario`、截图和 VCD 等自动化参数；`wokwi-cli lint` 检查图纸 JSON、未知器件、无效引脚和缺失组件。[W2] | `simulationCommand`；参数；expect/fail 规则；scenario 文件；串口日志；截图/VCD 文件；timeout；lint 报告；退出码。 | expect-text 只证明日志出现文本；VCD/截图只证明仿真输出；lint 通过不证明 BOM、真实器件、焊接、供电或负载存在。 |
| Automation scenario 官方当前标为 alpha；场景可以 delay、expect-pin、set-control、wait-serial、write-serial、take-screenshot 等，传感器控制量由仿真模型提供。[W4] | `scenarioVersion`；步骤类型；控制量；等待/超时；串口断言；截图比较结果；仿真模型版本/图纸 hash。 | 不能把 alpha API 当作稳定硬件测试协议；不能从模型中的温湿度、按键、电位器或加速度值推断现场传感器校准、噪声、响应时间或真实 GPIO 电平。 |
| 官方 GitHub Action 使用 `wokwi/wokwi-ci-action@v1`；GitHub Actions 示例覆盖 ESP32、STM32 Nucleo 和 Raspberry Pi Pico。[W5] | `ciProvider=GitHub Actions`；action/version；workflow run；仿真产物；日志和退出码。 | 不能从 CI workflow 名称推断真实板型已连接；不能把 action 运行成功当作物理烧录成功。 |
| 官方价格页区分 Community、Hobby、Pro；Community 面向开源/公开项目，Hobby 提供个人未列出项目及私有能力，Pro 面向商业使用并提供更高 CI 分钟数；私有 IoT gateway 属于付费边界。[W6] | `plan`；项目公开/未列出/私有状态；CI 分钟配额；gateway 可见性；是否商业使用；账单/配额状态。 | 不能假设免费 Community 允许把商业闭源项目或私有 gateway 当作无限制生产服务；配额和产品政策变化时必须重新读取官方价格页。 |
| 官方 CLI 还提供实验性 MCP 支持，需 CI 认证；官方明确其为 experimental。[W7] | `mcpEnabled`；CLI/MCP 版本；实验性标记；调用日志和退出码。 | 不能把实验性 MCP 视为稳定 API、长期 SLA 或真实硬件控制通道。 |

Wokwi 适合做图纸/固件的可重复软件回归、串口协议、状态机和部分外设行为检查。它不能替代本项目需要的真实 Arduino CLI + 真实 USB/串口 + 真实板卡写入证据。产品数据模型应把 `simulationVerified` 和 `physicalVerified` 设为不同证据字段，不能共享一个“硬件通过”布尔值。

## 组件官方资料入口

### DHT22 / AM2302

ASAIR/Aosong 官方产品目录提供 AM2302 产品条目，页面标题为 “ASAIR AM2302 Temperature and Humidity Sensor Modules”，并显示 “Inquiry For Datasheet”；官方下载中心和设计指南是资料入口，但本次访问未发现可直接作为 AM2302 完整电气规格的公开专用数据手册。[C1][C2][C3]

| 可直接导入产品的数据字段 | 不能据此推断的字段 |
|---|---|
| `manufacturer=ASAIR/Aosong`；`model=AM2302`；`category=temperature/humidity sensor module`；`officialProductUrl=C1`；`datasheetStatus=inquiry`；`sourceAccessDate=2026-08-16`。 | 不能仅凭官方产品条目导入 DHT22 与 AM2302 的等价关系、供电范围、温湿度量程、精度、分辨率、采样间隔、平均电流、启动时间、数据协议细节、引脚定义、上拉电阻、尺寸或模块版本。也不能把仓库当前 3.3-5.5 V、2.5 mA 视为已由专用官方数据手册证实。 |

### SSD1306 / OLED

Solomon Systech 官方 OLED 产品分类页将 SSD1306 定义为 “128 x 64 Mono OLED Driver with charge pump”，并列出内部 charge pump regulator、Mass Production 状态；数据手册入口为 “Send Request”。[C4]

| 可直接导入产品的数据字段 | 不能据此推断的字段 |
|---|---|
| `manufacturer=Solomon Systech`；`controller=SSD1306`；`controllerResolution=128x64`；`monochrome=true`；`internalChargePump=true`；`lifecycle=Mass Production`；`officialProductUrl=C4`；`datasheetStatus=send request`。 | 不能把控制器字段扩展成任一“0.96 inch OLED 模块”的屏幕外形、有效区域、模块尺寸、供电/逻辑电平、I2C 地址、SPI/I2C 接线、上拉电阻、峰值/平均电流、连接器、玻璃批次或模块是否带电平转换。当前仓库的 3.3-5 V、20 mA 需要具体模块料号和手册。 |

### BMP280

Bosch Sensortec 官方页面与数据手册确认 BMP280 是绝对气压传感器：压力 300-1100 hPa，温度 -40 至 85 °C，VDD 1.71-3.6 V，VDDIO 1.2-3.6 V，支持 I2C/SPI；官方产品页还列出约 ±1 hPa 的条件化绝对精度、典型 3.4 µA@1 Hz、睡眠 0.1 µA、约 5.5 ms 测量时间、2.0 x 2.5 x 0.95 mm LGA 封装，并标为不建议新设计、推荐 BMP390。[C5][C6]

| 可直接导入产品的数据字段 | 不能据此推断的字段 |
|---|---|
| `manufacturer=Bosch Sensortec`；`partNumber=BMP280`；`pressureRange=300-1100hPa`；`temperatureRange=-40..85C`；`vdd=1.71-3.6V`；`vddio=1.2-3.6V`；`interface=I2C/SPI`；`measurementTime≈5.5ms`；`sleepCurrent=0.1µA`；`package=LGA 2.0x2.5x0.95mm`；`lifecycle=not available for new designs`；`datasheet=BST-BMP280-DS001 Rev.1.26, 10/2021`。 | 不能由裸芯片资料推断某个 breakout 模块的 VIN 是否能接 5 V、板上是否有稳压/电平转换、I2C 地址、引脚丝印、上拉电阻、连接器、模块静态电流、校准常数质量或第三方板的温度/气压误差。 |

### SG90

Tower Pro 官方 SG90 页面标注为官方制造商页面，正式产品表列出重量 9 g、尺寸约 23 x 12.2 x 29 mm、4.8 V 供电、1.8 kg/cm 堵转扭矩（4.8 V）、0.1 s/60° 速度（4.8 V）、0-55 °C、1 µs deadband、25 cm 线和 JR 插头，并说明电源应通过外部适配器供给。[C7]

| 可直接导入产品的数据字段 | 不能据此推断的字段 |
|---|---|
| `manufacturer=Tower Pro`；`model=SG90`；`mass=9g`；`dimension≈23x12.2x29mm`；`operatingVoltage=4.8V`；`stallTorque=1.8kg/cm@4.8V`；`speed=0.1s/60deg@4.8V`；`temperature=0..55C`；`deadband=1µs`；`wire=25cm`；`connector=JR`；`powerSource=external adapter`；`officialProductUrl=C7`。 | 不能把页面评论中的“约 0.5-2 A”当作正式额定/典型电流；不能据此导入 250 mA。不能仅凭 SG90 名称推断 PWM 周期、脉宽范围、行程角、逻辑阈值、堵转持续时间、启动浪涌、MCU GPIO 供电能力、舵机批次一致性或具体仿制品参数。 |

### 继电器

当前仓库只有泛化“继电器模块”，没有制造商和料号，因此没有可唯一绑定的一手来源。Songle 官方 SRD(T73) 页面/规格 PDF 可以作为候选裸继电器系列的资料入口：页面列出 7/10/15 A 触点等级、250 VAC/28 VDC 等触点条件、5-48 VDC 线圈系列、0.36/0.45 W 线圈功耗、机械寿命 10^7 次、电气寿命按负载条件列出 10^5/10^4 次，并给出绝缘、介电强度、温度和 PCB 端接信息。[C8][C9]

| 可直接导入产品的数据字段 | 不能据此推断的字段 |
|---|---|
| 在确认实际裸继电器为 Songle SRD(T73) 且匹配具体线圈/触点后，才可导入 `manufacturer=Ningbo Songle Relay`；`series=SRD(T73)`；`contactRating`（必须带 AC/DC、阻性/感性条件）；`coilNominal=5..48VDC family`；`coilPower=0.36/0.45W family`；`mechanicalEndurance=10^7`；相应绝缘和温度字段；`officialProductUrl=C8/C9`。 | 不能把 SRD(T73) 裸继电器字段直接导入当前“模块”：不能推断模块输入门限、三极管/光耦、续流二极管、LED、电阻、线圈实际电流、3.3 V 兼容性、NO/NC/COM 排布、端子间距、爬电距离、外壳阻燃等级或整板安全认证。不能把 10 A 触点宣传值用于任意电压、负载、温度和寿命条件。 |

对继电器和市电负载，产品记录至少需要 `moduleManufacturer`、`moduleMPN`、`relayManufacturer`、`relayMPN`、模块原理图、触点类别、负载类型、降额曲线和安全间距资料。缺少这些字段时，应标记为“候选资料/未核验”，不能标记为可生产。

## 建议的数据导入契约

本次盘点建议将“硬件事实”和“运行证据”分层保存：

| 层 | 必备字段 |
|---|---|
| 身份 | `manufacturer`、`partNumber`、`variant/SKU`、`objectScope`（chip/module/board/component/tool）、`officialSourceUrl`、`sourceVersion`、`sourceDate`、`accessedAt` |
| 板卡 | `boardModel`、MCU 型号、实际用户 GPIO、接口复用、逻辑电平、供电入口、Flash/SRAM/EEPROM、连接器、调试器/bootloader |
| 器件 | 额定/工作电压、VDD/VDDIO、测试条件下的电流类型、接口、电气引脚类型、量程/精度、封装/尺寸、生命周期 |
| 工具 | 工具版本、核心/包/库版本、完整 FQBN、命令参数（去除凭据）、输入输出绝对路径、退出码、日志和产物 hash |
| 证据 | `simulationVerified`、`ercVerified`、`buildVerified`、`physicalVerified` 分开保存；每个字段绑定报告、时间戳和来源对象 |

以下字段在没有直接来源时不应自动补齐：

- 从芯片资料推断开发板引脚、Flash/PSRAM、USB、天线、跳帽或电源拓扑。
- 从控制器型号推断显示模块尺寸、地址、接线、电流和逻辑电平。
- 从裸继电器型号推断继电器模块的驱动器和市电安全属性。
- 从“典型电流”或搜索结果片段推断额定电流、峰值电流、浪涌电流或设计电源。
- 从 Arduino CLI compile、KiCad ERC、Wokwi lint/仿真或端口发现推断真实物理硬件已通过。

## 当前仓库的优先补齐项

1. 将平台身份拆分为 `chip`、`module`、`board` 三层；特别是 ESP32-S3 与 RP2040/Pico。
2. 为 NUCLEO-F401RE 重新核对 STM32duino 核心、已安装包版本和完整 FQBN；不要沿用未核实的 `STM32F1` core 标记。
3. 给 DHT22、OLED、BMP280、SG90、继电器补充制造商、精确料号、官方来源状态；没有模块料号时保持未知，不用经验值填空。
4. 将 Arduino CLI 的编译、上传后校验、KiCad ERC、Wokwi 仿真和真实物理上传建成四类不同证据，分别保存退出码、报告/日志、输入产物 hash 和时间。
5. 对 SG90 清除未经正式数据手册支持的 `250 mA` 典型电流假设；对继电器的 `70 mA` 和“需要续流二极管”也应改为具体模块/电路证据，而非泛化组件字段。

## 官方来源登记

所有链接均为一手来源；未标注版本/日期的页面已明确注明。访问日期均为 2026-08-16。

| 编号 | 官方发布方 | 直接官方 URL | 文档版本/更新时间 |
|---|---|---|---|
| U1 | Arduino | https://store.arduino.cc/products/arduino-uno-rev3 | 产品页未标注版本/更新时间 |
| U2 | Arduino | https://docs.arduino.cc/resources/datasheets/A000066-datasheet.pdf | 页面标注 Modified: 2026-05-07 |
| U3 | Arduino | https://docs.arduino.cc/hardware/uno-rev3/?setlang=en | 硬件页未标注版本/更新时间 |
| E1 | Espressif | https://www.espressif.com/en/support/documents/technical-documents/datasheets/ESP32-S3-Datasheet.pdf | 官方技术资料页列出 ESP32-S3 Datasheet v2.2，2026-03-05；页面/下载状态以访问时为准 |
| E2 | Espressif | https://www.espressif.com/sites/default/files/documentation/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf | 官方技术资料页列出 ESP32-S3-WROOM-1/WROOM-1U Datasheet v1.8，2026-03-02 |
| E3 | Espressif | https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/index.html | ESP-IDF stable 文档；页面未在条目处标单独修订日期 |
| E4 | Espressif | https://github.com/espressif/arduino-esp32/blob/master/.github/CI_README.md | 官方仓库 `master`；滚动内容，未标注固定版本 |
| R1 | Raspberry Pi | https://datasheets.raspberrypi.com/rp2040/rp2040-datasheet.pdf | 官方数据手册；PDF 版本/日期以文件封面为准，产品页未给固定版本 |
| R2 | Raspberry Pi | https://pip-assets.raspberrypi.com/categories/610-raspberry-pi-pico/documents/RP-008307-DS-1-pico-datasheet.pdf | Pico 板数据手册；PDF 版本/日期以文件封面为准 |
| R3 | Raspberry Pi | https://pip.raspberrypi.com/categories/610-raspberry-pi-pico | 官方产品文档门户标注 pico-datasheet、getting-started-with-pico Updated: 2026-07-15 |
| R4 | Raspberry Pi | https://www.raspberrypi.com/products/rp2040/specifications/ | 产品规格页未标注单独版本/更新时间 |
| R5 | Earle F. Philhower, III（Arduino-Pico 官方核心仓库） | https://github.com/earlephilhower/arduino-pico/blob/master/tools/makeboards.py | 官方核心仓库滚动 `master`；未标注固定版本 |
| N1 | STMicroelectronics | https://www.st.com/en/evaluation-tools/nucleo-f401re.html?icmp=tt31374_gl_lnkon_mar2023 | 板卡页：DB2196 v22 更新 2026-02-22；UM1724 v17 更新 2025-09-30；其他资源以页面为准 |
| N2 | STMicroelectronics | https://www.st.com/resource/en/data_brief/nucleo-f401re.pdf | DB2196；搜索结果/文件版本可能随页面更新，当前板卡页列 v22、2026-02-22 |
| N3 | STMicroelectronics | https://www.st.com/resource/en/user_manual/dm00105823.pdf | UM1724 v17，2025-09-30（板卡页资源元数据） |
| N4 | STMicroelectronics | https://www.st.com/resource/en/datasheet/stm32f401re.pdf | DS10086 Rev.5，2026-02（官方产品资料索引） |
| N5 | STMicroelectronics / STM32duino | https://github.com/stm32duino/Arduino_Core_STM32 | 官方核心仓库滚动内容；支持矩阵/包索引未绑定本报告固定版本 |
| A1 | Arduino | https://arduino.github.io/arduino-cli/1.3/integration-options/ | Arduino CLI 1.3 文档 |
| A2 | Arduino | https://arduino.github.io/arduino-cli/1.3/commands/arduino-cli_compile/ | Arduino CLI 1.3 命令参考 |
| A3 | Arduino | https://arduino.github.io/arduino-cli/1.3/commands/arduino-cli_upload/ | Arduino CLI 1.3 命令参考 |
| A4 | Arduino | https://arduino.github.io/arduino-cli/1.3/commands/arduino-cli_board_list/ | Arduino CLI 1.3 命令参考 |
| A5 | Arduino | https://arduino.github.io/arduino-cli/1.2/sketch-project-file/ | Arduino CLI 1.2 文档；页面介绍 profile/project file |
| A6 | Arduino | https://github.com/arduino/arduino-cli | 官方仓库；本次访问显示 latest release v1.5.0，2026-05-19 |
| K1 | KiCad | https://www.kicad.org/download/windows/ | 稳定版 10.0.5（本次访问页面状态） |
| K2 | KiCad | https://www.kicad.org/blog/2026/03/Version-10.0.0-Released/ | 10.0.0 发布公告，2026-03-20 |
| K3 | KiCad | https://docs.kicad.org/10.0/en/cli/cli.html | KiCad 10.0.5 CLI 手册；文档修订 `a77c36a3` |
| W1 | Wokwi | https://docs.wokwi.com/wokwi-ci/cli-installation | Wokwi CI CLI 文档；页面未标注固定版本 |
| W2 | Wokwi | https://docs.wokwi.com/wokwi-ci/cli-usage | Wokwi CI CLI 文档；页面未标注固定版本 |
| W3 | Wokwi | https://docs.wokwi.com/wokwi-ci/getting-started | Wokwi CI 文档；含云端、删除固件、分钟配额说明 |
| W4 | Wokwi | https://docs.wokwi.com/wokwi-ci/automation-scenarios | Automation scenarios；官方标注 Alpha |
| W5 | Wokwi | https://docs.wokwi.com/wokwi-ci/github-actions | 官方 GitHub Actions 文档；示例使用 `wokwi/wokwi-ci-action@v1` |
| W6 | Wokwi | https://wokwi.com/pricing | 官方价格页；套餐/配额随时间变化 |
| W7 | Wokwi | https://docs.wokwi.com/wokwi-ci/mcp-support | MCP 支持；官方标注 Experimental |
| C1 | ASAIR/Aosong | https://www.aosong.com/en/Products/info.aspx?itemid=2294&lcid=139 | AM2302 产品页；显示 Inquiry For Datasheet，未标注数据手册版本 |
| C2 | ASAIR/Aosong | https://www.aosong.com/en/DownloadCenter/index.aspx | 官方下载中心；未找到专用公开版本号 |
| C3 | ASAIR/Aosong | https://aosong.com/userfiles/files/Aosong%20Electronic%20Temperature%20and%20Humidity%20Sensor%20Design%20Guide.pdf | Design Guide V1.0，2021-05；通用指南，不等同 AM2302 专用数据手册 |
| C4 | Solomon Systech | https://www.solomon-systech.com/product-category/oled-display | SSD1306 产品分类页；Mass Production，数据手册为 Send Request，未标注公开版本 |
| C5 | Bosch Sensortec | https://www.bosch-sensortec.com/products/environmental-sensors/pressure-sensors/bmp280/ | 产品页未标注固定版本；当前状态 Not available for new designs |
| C6 | Bosch Sensortec | https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmp280-ds001.pdf | BST-BMP280-DS001 Rev.1.26，10/2021 |
| C7 | Tower Pro | https://towerpro.com.tw/product/sg90-7/ | 正式产品页未标注固定版本/更新时间 |
| C8 | Songle Relay | https://www.songlerelay.com/srd-t73-relay.html | 产品页版权 2025；未标注固定数据手册版本 |
| C9 | Songle Relay | https://www.songlerelay.com/upload/8670/srd-t73-relay-290486.pdf | 官方 PDF；公开页面未标注修订日期/版本 |

本文件没有写入任何环境变量、访问令牌或密钥，也没有修改源代码。
