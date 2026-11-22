# 公開影片補充測試

這些影片用於工程驗證，不算正式收案，也沒有關節人工真值；以下比例不是 PCK、AP 或臨床準確率。

## AIR-400 官方 demo

- 來源：<https://github.com/michaelwwan/air-400>
- 官方檔案：<https://coe.northeastern.edu/Research/AClab/AIR-400/demo-air-400-s05-23.mp4>
- SHA256：`66b987a4e380b97c7a737090c65d2e04e931a4690ac72bb3129c0898fbb996f5`
- 完整解碼 608 影格，10 FPS，60.8 秒。夜視／紅外線影像，可用來檢查灰階輸入、衣物遮擋與靜止片段。
- 使用與網站相同的 RTMPose-M 模型、192×256 輸入、全畫面固定 ROI，由桌面 rtmlib 管線產生原始關節座標，再交給本專案 JavaScript schema 2.0 計算擴充指標。
- 40% 門檻：關節判定率 **88.4094%**；20% 門檻：**100%**。最低原始分數約 0.233276。
- 20% 門檻下軀幹有效率 **100%**；共 119 筆關節視窗，其中 102 筆通過特徵品質。最後不足一秒的視窗因微分資料不足留空，沒有為了取得數值取消品質條件。
- 輸出 42 筆協調性、28 筆角度視窗紀錄，品質不足的欄位保持 null。

AIR-400 的官方標註是呼吸訊號，不是人體關節真值。AIR-125 與 AIR-400 子集內相同 Sxx ID 也不代表同一受試者；未來建立測試清單須用 `dataset/subset/subject/clip` 複合代碼，避免資料洩漏與錯誤合併。

官方程式庫標示 MIT，資料再利用應同時查閱原始資料說明。此次只下載到被 Git 忽略的 `outputs/`，未把影片或呼吸標註重新發布到 GitHub Pages。

## BabyPose 全身範例

- 來源：`meyurtsever/BabyPose/data/kicking_legs/kicking_legs_14.mp4`。
- 11.26125 秒、270 個原始影格。桌面全幀：40% 門檻通過 96.3399%，20% 門檻通過 100%。
- 前次網站版在 30 FPS 要求下產生 327 個取樣點（瀏覽器部分解碼採近似時間），20% 門檻為 5,559 / 5,559 點通過。這是同一片段的瀏覽器取樣測試，不是新增受試者。
- 公開短片只有約 11 秒，可練習操作，不符合計畫的連續 3 分鐘研究納入條件。

## 重跑方式

本機可選用 `scripts/evaluate_pose_video.py` 輸出完整 raw tracks，再以 `scripts/measure_tracks.mjs` 執行網站的相同指標函式。需額外安裝 numpy、opencv-python、rtmlib 及 onnxruntime；不需要安裝於私人資料庫伺服器。

```sh
python scripts/evaluate_pose_video.py path/to/demo.mp4 --output outputs/raw.json
node scripts/measure_tracks.mjs outputs/raw.json outputs/result.json 0.2
```

可用 `python scripts/prepare_web.py` 先準備與驗證模型。評估腳本會從已驗證模型分塊建立本機 ONNX 檔，不把影片或輸出加入部署。
