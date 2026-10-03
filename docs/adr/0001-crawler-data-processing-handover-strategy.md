# ADR 0001: Chiến lược Bàn giao Dữ liệu giữa gem-crawler và gem-data-processing

- **Mã định danh:** ADR-0001
- **Trạng thái:** ACCEPTED (Đã chấp thuận)
- **Ngày quyết định:** 03/10/2026
- **Người đề xuất:** @Leonard
- **Tài liệu tham chiếu:** [High-Level Design.pdf](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/High-Level%20Design.pdf) (Trang 2, 3, 5)

---

## 1. BỐI CẢNH (CONTEXT)

Hệ thống **OmniGem Knowledge Platform** chia tách trách nhiệm thành các module độc lập theo luồng dữ liệu một chiều `[HLD p.1, p.2]`:
- `gem-crawler`: Chạy batch CLI trên máy local để thu thập trang web, lưu trữ snapshot HTML nguyên bản nén (`.html.gz`), bóc tách văn bản sạch và tính mã băm SHA-256.
- `gem-data-processing`: Xưởng tinh chế tiếp nhận tài liệu thô, gọi LLM (Gemini 3.8 / Claude) trích xuất Fact có dẫn chứng, đối chiếu ngũ hành và publish sang `gem-kb`.

### Vấn đề cần giải quyết:
Đầu ra của `gem-crawler` cần được đẩy lên đâu và bàn giao bằng cơ chế nào để `gem-data-processing` có thể tự động tiếp nhận và xử lý, đồng thời:
1. Đảm bảo tính độc lập tuyệt đối giữa 2 repository (không phụ thuộc chéo package, không couple trực tiếp vào database nội bộ của nhau theo `[HLD p.5]`).
2. Tối ưu chi phí và tốc độ phát triển ở giai đoạn hiện tại (P0–P1: cả 2 repo cùng chạy trên môi trường phát triển local).
3. Có lộ trình nâng cấp liền mạch lên Cloud Storage (Data Lake) trong tương lai (P2+) mà không phải đập đi xây lại kiến trúc cốt lõi.

---

## 2. CÁC PHƯƠNG ÁN ĐÃ ĐÁNH GIÁ (CONSIDERED OPTIONS)

### Phương án 1: Thư mục trung chuyển Local ("Drop & Ingest" qua Newline Delimited JSON)
- **Cơ chế:** `gem-crawler` xuất dữ liệu ra file `.ndjson` vào thư mục tiếp nhận quy ước `incoming/` của `gem-data-processing`, kèm theo file bản sao JSON Schema `raw-document.schema.json`. `gem-data-processing` có lệnh `ingest` tự động quét thư mục này.
- **Ưu điểm:**
  - 100% chi phí 0đ, không cần cài đặt hạ tầng mạng hay tài khoản cloud.
  - Tốc độ đọc ghi đĩa local tức thì, hoạt động offline.
  - Tuân thủ nghiêm ngặt HLD Trang 5: Hợp đồng kiểm định bằng JSON Schema Draft 2020-12 đi kèm mỗi lần chạy.
  - Định dạng NDJSON cho phép đọc stream từng dòng, không tốn RAM.
- **Nhược điểm:** Yêu cầu cả hai repository nằm trên cùng một máy vật lý ở giai đoạn đầu.

### Phương án 2: Cloud Object Storage Data Lake (Cloudflare R2 / AWS S3)
- **Cơ chế:** Crawler upload các file `.ndjson` và snapshot nén lên một S3-compatible bucket (ví dụ `s3://omnigem-raw-lake/runs/{run_id}/`). `gem-data-processing` kéo dữ liệu từ bucket về xử lý.
- **Ưu điểm:**
  - Hoàn toàn tách rời hạ tầng máy tính (Crawler chạy ở máy local, Processing chạy trên Cloud/Worker).
  - Lưu trữ bền vững hàng trăm ngàn snapshot mà không lo đầy ổ cứng máy cá nhân.
  - Chọn **Cloudflare R2** mang lại lợi thế chiến lược: **Zero Egress Fee** (miễn phí 100% băng thông tải ra ngoài) và miễn phí 10GB lưu trữ đầu tiên.
- **Nhược điểm:** Cần cấu hình Access Key, quản lý bảo mật IAM, và có độ trễ mạng khi upload/download. Chưa cần thiết ở giai đoạn P0.

### Phương án 3: Đọc trực tiếp SQLite Database (`crawler.db`)
- **Cơ chế:** `gem-data-processing` mở kết nối SQLite trực tiếp vào `../gem-crawler/data/crawler.db` ở chế độ Read-Only để query bảng `raw_documents`.
- **Ưu điểm:** Bỏ qua bước xuất file trung gian.
- **Nhược điểm:** Vi phạm nguyên tắc ranh giới hợp đồng `[HLD p.5]`. Làm cho `gem-data-processing` bị trói chặt (tightly coupled) vào schema SQLite nội bộ của crawler; khi crawler sửa cấu trúc DB, data-processing sẽ bị gãy.

---

## 3. QUYẾT ĐỊNH (DECISION)

Chúng tôi quyết định áp dụng **Chiến lược Phân kỳ 2 Giai đoạn (Two-phase Hybrid Strategy)**:

### Giai đoạn 1 (Hiện tại: P0 – P1): Áp dụng Phương án 1 (Local Drop & Ingest)
1. **Ranh giới thư mục quy ước:**
   - Đầu ra xuất tại: `../gem-data-processing/incoming/raw_documents_{date}_{run_id}.ndjson`.
   - Schema hợp đồng kèm theo tại: `../gem-data-processing/incoming/schemas/raw-document.schema.json`.
2. **Quy trình bàn giao:**
   - Phía Crawler chạy:
     ```bash
     gem-crawler export --output ../gem-data-processing/incoming/raw_documents.ndjson
     ```
   - Phía Data Processing chạy:
     ```bash
     gem-data-processing ingest
     ```
3. **Cơ chế Watermark & Deduplication:**
   - Sau khi `gem-data-processing` xử lý xong file `.ndjson`, file sẽ được tự động di chuyển vào thư mục lưu trữ `incoming/processed/` hoặc cập nhật trạng thái ingestion vào SQLite của Processing để tránh xử lý lặp lại.

### Giai đoạn 2 (Mở rộng: P2+): Bổ sung Adapter Cloudflare R2
- Khi hệ thống chuyển sang chạy phân tán (Crawler chạy định kỳ trên VPS hoặc server riêng):
  - Bổ sung flag `--r2` cho lệnh export của crawler:
    ```bash
    gem-crawler export --r2 --bucket omnigem-raw-lake
    ```
  - Bổ sung flag `--from-r2` cho `gem-data-processing ingest`.
  - Giữ nguyên cấu trúc dữ liệu NDJSON và Schema Contract v1.0.0, chỉ thay đổi tầng vận chuyển (Transport Layer).

---

## 4. HỆ QUẢ & TÁC ĐỘNG (CONSEQUENCES)

### Tác động tích cực:
- **Tập trung cao độ vào nghiệp vụ cốt lõi:** Không mất thời gian dựng hạ tầng Cloud phức tạp ở thời điểm hiện tại; tập trung xây dựng logic bóc tách Fact LLM ở Stage 2.
- **Tuân thủ triệt để Data Contract:** Dữ liệu luôn được xác thực tính hợp lệ bằng JSON Schema Draft 2020-12 trước khi đưa vào LLM.
- **Hiệu năng cao:** NDJSON cho phép xử lý streaming bộ nhớ thấp ($O(1)$ RAM), phù hợp xử lý hàng ngàn bài viết.
- **Lộ trình Cloud rõ ràng:** Đã định sẵn kiến trúc dùng Cloudflare R2 (tiết kiệm chi phí băng thông tối đa) khi cần mở rộng quy mô.

### Giới hạn & Biện pháp giảm thiểu:
- *Giới hạn:* Yêu cầu 2 thư mục dự án `gem-crawler` và `gem-data-processing` nằm cạnh nhau trên máy dev.
- *Biện pháp:* Đã bổ sung tính năng tự động tạo thư mục cha (`mkdir -p`) trong mã nguồn lệnh `export` để đảm bảo lệnh luôn thực thi thành công không phụ thuộc vào việc thư mục `incoming` đã được tạo trước hay chưa.

---

## 5. THAM CHIẾU LIÊN QUAN
- [High-Level Design.pdf](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/High-Level%20Design.pdf)
- [CRAWLER_TOOLS_SPECIFICATION.md](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/docs/CRAWLER_TOOLS_SPECIFICATION.md)
- [raw-document.schema.json](file:///Users/leonard/Workspace/projects/omni-gems/gem-crawler/schemas/raw-document.schema.json)
