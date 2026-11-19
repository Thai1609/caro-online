# Cờ Caro Online

Web tiếng Việt cho hai người chơi qua mã phòng. Frontend dùng React và TypeScript. Backend dùng Spring Boot, REST và WebSocket. Bàn có 30 × 30 ô, kéo được bằng chuột hoặc cảm ứng. Từ 5 quân liên tiếp trở lên là thắng. Khi cả hai đồng ý chơi lại, người đi trước luân phiên mỗi ván.

## Chạy nhanh với Docker

Từ thư mục chứa Dockerfile:

```bash
docker build -t caro-online .
docker run --rm -p 8080:8080 caro-online
```

Mở http://localhost:8080. Người thứ nhất tạo phòng và gửi mã. Người thứ hai mở cùng địa chỉ từ một trình duyệt khác hoặc cửa sổ riêng tư, nhập tên và mã rồi bấm **Vào phòng**. Để thử từ điện thoại cùng Wi-Fi, thay localhost bằng địa chỉ IP nội bộ của máy chạy server và mở cổng 8080 trên tường lửa nếu cần. Nút sao chép dùng Clipboard API khi chạy qua HTTPS hoặc localhost. Trên HTTP qua IP nội bộ, giao diện vẫn hiển thị mã để bạn chép thủ công.

## Build và chạy bằng Java

Cần Node.js 22+, Java 21 và Maven 3.9+. Chạy từ thư mục gốc:

```bash
npm --prefix frontend ci
npm --prefix frontend run build
mvn -f backend/pom.xml clean package
java -jar backend/target/caro-online.jar
```

Mở http://localhost:8080. Frontend đã nằm trong JAR nên chỉ cần một tiến trình khi chạy. Nếu chỉ build lại backend, Maven lấy frontend từ thư mục `frontend/dist`. Chạy build frontend trước nếu vừa sửa giao diện.

## Phát triển trên máy

Terminal 1:

```bash
mvn -f backend/pom.xml spring-boot:run
```

Terminal 2:

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

Mở địa chỉ Vite in ra, thường là http://localhost:5173. Vite chuyển tiếp API và WebSocket đến backend tại cổng 8080.

## Đưa lên Git và triển khai

Tạo repository trống trên GitHub hoặc GitLab. Dùng URL Git của repository đó thay cho phần giữ chỗ bên dưới:

```bash
git init -b main
git add .
git commit -m "Initial Caro Online project"
git remote add origin <URL_REPOSITORY>
git push -u origin main
```

Triển khai repository dưới dạng **dịch vụ web chạy Docker**. Host cần nhận HTTP và chuyển tiếp nâng cấp WebSocket ở đường dẫn `/ws`. Nếu host cung cấp biến môi trường `PORT`, ứng dụng sẽ lắng nghe cổng đó. Khi truy cập bằng HTTPS, giao diện tự dùng WSS. Để hai người chơi từ ngoài mạng nội bộ, gửi URL của dịch vụ đã triển khai. GitHub Pages chỉ phục vụ file tĩnh nên không chạy được server Spring Boot.

Chọn **một instance** vì phòng đang lưu trong RAM. Tải lại cùng tab giữ phiên và bàn cờ nếu server vẫn hoạt động. Chọn **Rời phòng** khi đang kết nối sẽ đóng phòng cho cả hai. Phòng không còn kết nối hết hạn sau khoảng 30 phút. Khởi động lại server làm mất các ván đang mở.

## Cấu trúc

- `frontend/src/Board.tsx` xử lý lưới, di chuyển vùng nhìn và chọn ô.
- `frontend/src/main.tsx` xử lý phòng, giao diện và kết nối lại.
- `backend/src/main/java/vn/caro/GameServer.java` quản lý phòng, xác thực phiên và áp dụng luật chơi.
