# 指標與資料定義（schema 2.0）

## 共同處理

COCO 17 點；有限座標且分數 ≥ 信心門檻才算觀測點。分母保留缺失點。短缺口線性補值，依時間戳辨識斷段，三階 Savitzky–Golay 平滑。以骨盆中心為原點、肩到骨盆為垂直方向，以整段有效軀幹長度中位數為固定比例尺。以下位置均為二維投影，單位 TL 代表軀幹長度，不等於公分。

每關節、每個時間窗分別計算；不足最低有效比例或連續可微分時間時輸出 null。速度超過設定 max_speed 時該視窗標記 speed_outlier。微分採實際非均勻時間戳的三點二階差分，連續片段至少 9 點，且長度達 min_segment_s；去除各段頭尾 3 點以減少高階微分邊界效應。

| 類別 | 欄位 | 定義與單位 |
|---|---|---|
| 速度 | speed_mean / sd / median / p95 / peak | 有效速度範數的平均、母體 SD、中位數、P95 與最大值，TL/s |
| 加速度 | acceleration_rms / peak | 二階微分範數的 RMS 與最大值，TL/s² |
| 變異度 | position_variability | 二維座標相對平均位置的 RMS 距離，TL |
| 方向變異 | variability_x / y | x 與 y 座標的母體 SD，TL |
| 幅度 | amplitude_x / y | 各方向 P95−P05，TL |
| 合成幅度 | amplitude | hypot(amplitude_x, amplitude_y)，TL |
| 路徑 | path_length | 相鄰有效點間距累加，不跨越缺口或斷段，TL |
| 路徑時間 | path_observed_s | 納入路徑累加的相鄰時間間距總和，s |
| 路徑平均速度 | path_mean_speed | path_length / path_observed_s，TL/s |
| 位移 | displacement | 完整連續視窗末點與起點距離，TL；有缺口留空 |
| 直線度 | straightness | displacement / path_length，0–1；路徑小於 1e-4 TL 或有缺口留空 |
| 平滑度 | jerk_rms | 三階位置微分向量的 RMS，TL/s³；愈低代表此設定下軌跡較平滑 |
| 標準化平滑度 | dimensionless_squared_jerk | T⁵ × ∫‖jerk‖²dt / L²；T 與 L 均只取同一個連續內部可微分區間，不額外乘 1/2。L ≤1e-4 TL、分段或近乎靜止時留空 |
| 微分時間 | derivative_duration_s | 有效相鄰 jerk 點的間距總和，s |

jerk、峰值與路徑容易受頻率、噪音和濾波影響。比較不同影片或訪視須保留取樣方式與平滑參數，不能將不同設定混合視為發展變化。

## 左右對稱性

肘、腕、膝、踝各自以左右共同有效時間計算。速度／幅度差異為 `2*abs(L-R)/(L+R)`，範圍 0–2，近乎靜止時留空。鏡射距離 RMS 將左點 x 反號後與右點比較；速度相關為 Pearson 相關，任一側速度 SD ≤1e-5 時留空。

## 協調性

雙腕、雙踝、同側腕踝與對側腕踝共六組。以相同時間點、共同可微分速度計算 Pearson r（−1 至 1），共同微分比例達 min_coverage、至少 3 點且無速度跳點才輸出。兩者任一近乎靜止時為 inactive。這是速度共變描述，不等於完整的神經動作協調能力或相位同步模型。

## 二維關節角度

肩–肘–腕及髖–膝–踝的夾角 arccos(dot(u,v)/(‖u‖‖v‖))，單位 degree。輸出平均、SD、P05、P95 及 P95−P05。這是二維投影角，不是三維臨床關節活動度；遮擋與攝影角度會影響數值。

## 品質欄位

coverage 是補值和平滑後可建立正規化座標的比例；observed_fraction 是原始信心通過比例；interpolated_fraction 是補值比例；derivative_fraction 是可微分比例；speed_outlier_fraction 是速度高於 max_speed 的比例。null 表示未能計算，不能換成零。

## 語音基礎管線（energy-autocorrelation/1.0）

瀏覽器以 Web Audio 解碼、下混單聲道，要求至少 8 kHz、最長 600 秒；通常請求 16 kHz。80 Hz 一階高通移除 DC／低頻隆聲。40 ms 幀、20 ms hop；以 RMS 能量建立候選端點，門檻取使用者最低 dBFS 與第 20 百分位噪音估計 +6 dB 的較高者。保留 ≥100 ms 片段，合併小於 100 ms 的間隔。

每 100 ms 對活動幀做正規化自相關峰值搜尋，範圍 150–1200 Hz，峰值相關需大於 0.6。輸出音高中位數、IQR、樣本數、活動比例、ZCR、削波比例、能量事件次數／分鐘及事件起點間距平均／SD。未通過條件的音高留空。

能量事件可能是成人語音、哭聲、環境聲或動作聲。需人工標記 infant_vocal / cry / coo / babbling / adult / noise；reviewed_infant_events 與 reviewed_vocalizations_per_minute 只計入人工確認的嬰兒類別。未使用已驗證嬰兒語音模型，未自動計算音節結構或 canonical babbling ratio。聲學描述與臨床判讀分開保存。

## 月齡與縱向比較

實足月齡＝收案月齡＋自收案日起天數／30.4375。未滿 24 個月者，若已提供出生週數，校正月齡＝max(0,實足月齡−max(0,40−出生週數)×7／30.4375)；24 個月後使用實足月齡。此為平台統一研究計算規則，量表自身適用規則由評估人員決定。

縱向圖只選已通過審閱的動作結果，同一 schema_version、model SHA256、coordinate_frame 與完整 config，並取每訪視最新同設定分析。每關節跨視窗以視窗時長加權平均；未通過品質的視窗排除。尚未建立族群常模，不輸出發展百分位或疾病機率。
