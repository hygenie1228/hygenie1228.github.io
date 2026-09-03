# HORIA project page (template)

TeHOR 페이지와 동일한 구조의 템플릿입니다. 본문 텍스트는 전부 lorem ipsum 자리표시자이고,
이미지/영상은 ffmpeg으로 만든 가벼운 플레이스홀더(총 ~200KB)입니다.

## 교체해야 할 것

### 1. 텍스트 (`index.html`)
- `<title>` / `og:*` / `twitter:*` 메타 태그
- 논문 제목, 저자 목록, VENUE 20XX
- TL;DR, Abstract, pipeline 설명
- BibTeX 블록

### 2. 링크 (`index.html`)
현재 `#` 또는 자리표시자로 되어 있습니다.
- arXiv, Video(YouTube), Code(GitHub) 버튼의 `href`
- 인트로 유튜브 영상: `<!-- Intro video -->` 섹션이 주석 처리되어 있습니다.
  영상이 준비되면 주석을 풀고 `VIDEO_ID`를 교체하세요.

### 3. 미디어 (`static/`)
같은 파일명으로 덮어쓰면 `index.html` 수정 없이 바로 반영됩니다.

| 경로 | 용도 |
|---|---|
| `static/HORIA.pdf` | 논문 PDF (**아직 없음 — 추가 필요**) |
| `static/images/thumbnail.png` | OG 썸네일 (1200x630) |
| `static/images/favicon.png` | 파비콘 & 제목 옆 아이콘 |
| `static/images/pipeline.jpg` | 파이프라인 그림 |
| `static/images/sample_1~6.png` | 입력 이미지 6장 |
| `static/videos/teaser_1~3.mp4` | 상단 티저 3개 |
| `static/videos/result_1a~6b.mp4` | 비교 슬라이더용 (a=before, b=after) |
| `static/videos/comparison_1~5.mp4` | 캐러셀 비교 영상 |

### 4. 색상 (`static/css/index.css`)
- `.horia-gradient` — 제목의 그라데이션 색 (현재 `#5e81ac → #88c0d0`)
- `index.html`의 `#5E81AC` — "HORIA (Ours)" 라벨 색

## 미디어 인코딩 권장

저장소 용량을 위해 원본을 그대로 올리지 말고 아래처럼 줄여서 커밋하세요.

```bash
# 영상: 폭 1600px 상한, crf 23
ffmpeg -i input.mp4 -vf "scale='min(1600,iw)':-2" -c:v libx264 -crf 23 \
  -preset slow -pix_fmt yuv420p -movflags +faststart -an output.mp4
```

## 로컬 미리보기

```bash
cd HORIA && python3 -m http.server 8000
# http://localhost:8000
```
