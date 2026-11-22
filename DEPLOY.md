# GitHub Pages HTML 版

本網站以 HTML、CSS、JavaScript 及 ONNX Runtime Web 執行。GitHub Pages 提供靜態檔案，RTMPose 模型在瀏覽器的 Web Worker 中推論，無須啟動 Python 或 Streamlit。

## 使用

1. 選擇瀏覽器可解碼的 MP4、WebM 或 MOV。
2. 在預覽拖曳圈選一名嬰幼兒，或輸入 X1、Y1、X2、Y2。範圍需涵蓋整段動作，避免照顧者入鏡。
3. 選擇取樣頻率與分析長度，按「開始分析」。首次載入約 54 MB 模型，依裝置與影片長度可能需等待。
4. 檢視骨架疊圖、軌跡、各視窗指標與左右差異，下載完整 JSON 或個別 CSV。
5. 完整 JSON 可重新匯入，並依其中保存的參數重算指標。原 Python `summary.json` 也可匯入摘要。

「試用合成示範」不載入模型，展示生成的 17 點運動資料，不是真實嬰幼兒影片或準確度結果。

## 發佈

專案的 `.github/workflows/pages.yml` 在部署時下載模型及執行檔、驗證 SHA256，再封裝至 `public/`。設定 **Settings → Pages → Source → GitHub Actions**，執行 `Publish Motion Lab` 工作流程。預設分支為 `main`。發布內容包含模型分塊與推論執行檔，不包含 `data/`、`outputs/`、`.venv/` 或研究附件。

網頁內使用相對路徑，支援 `https://帳號.github.io/儲存庫名稱/` 的子目錄。每個模型分塊約 16 MiB，單一靜態檔案低於 25 MiB，不使用 Git LFS。整個靜態網站約 67 MB。

若使用手動靜態檔案部署，先執行 `python scripts/prepare_web.py` 及 `python scripts/package_site.py`，將 `public/` 的完整內容上傳到靜態主機。直接發佈沒有模型資產的程式碼根目錄，無法執行影片推論。

## 本機預覽

先執行 `python scripts/prepare_web.py`，再執行 `python scripts/serve.py`，開啟 `http://127.0.0.1:8080`。這個伺服器也設定 Windows 所需的 JavaScript 模組 MIME 類型。不能直接以 `file://` 雙擊網頁，因為瀏覽器會限制模組、Worker 及模型讀取。

## 研究方法與限制

- 指標定義與 Python 管線 v1.0 對齊：短缺口線性補值、三階 Savitzky-Golay、骨盆中心／軀幹尺度座標、分段時間微分、位置 RMS 變異、分位數幅度、jerk RMS、雙側共同有效樣本。
- RTMPose-M 模型與 Python 版相同。網頁版使用使用者固定 ROI，不含 YOLOX 自動選人，也不會辨識年齡。
- 瀏覽器解碼與選定取樣頻率可能使影格與 Python 全幀解碼不同。支援時使用 `requestVideoFrameCallback.mediaTime`，重複時間點排除；回退 `currentTime` 時會在 JSON 紀錄。比較兩版時應使用相同座標與時間序列。
- 沒有 COOP/COEP 的 GitHub Pages 使用單執行緒 WASM。這是非即時逐影格分析，不能用桌面 CPU 版的速度推估本網頁速度。
- 影片及關節資料只在記憶體中處理，匯出由使用者下載。關閉或重新整理分頁會失去未匯出的結果。網站本身及模型檔仍會從 GitHub Pages 下載，GitHub 的存取紀錄政策適用。
- 研究量測沒有臨床常模或診斷效度。單鏡頭為 2D 投影，無比例尺時不能換算為公分；jerk 對解碼頻率、噪音與濾波敏感。
- 網頁版提供骨架播放與座標／指標匯出，不產生轉碼後的疊圖影片。原 Python 工具保留 MP4 匯出與批次資料評估。

模型資訊與 SHA256 在 `assets/model.json`，程式載入時驗證模型分塊與完整檔案。開源授權見 `NOTICE.txt`。
