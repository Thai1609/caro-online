package vn.caro;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.socket.*;
import org.springframework.web.socket.config.annotation.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Configuration
@EnableWebSocket
class SocketConfig implements WebSocketConfigurer {
    private final GameServer game;

    SocketConfig(GameServer game) {
        this.game = game;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(game, "/ws");
    }
}

@RestController
@RequestMapping("/api/rooms")
class RoomController {
    record Name(String name) {}

    private final GameServer game;

    RoomController(GameServer game) {
        this.game = game;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    GameServer.Ticket create(@RequestBody Name input) {
        return game.create(input.name());
    }

    @PostMapping("/{code}/join")
    GameServer.Ticket join(@PathVariable String code, @RequestBody Name input) {
        return game.join(code, input.name());
    }
}

@Component
class GameServer extends TextWebSocketHandler {
    private static final int SIZE = 30;
    private static final String ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final long IDLE_LIMIT = Duration.ofMinutes(30).toMillis();
    private final ObjectMapper json;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Room> rooms = new HashMap<>();
    private final Map<String, Connection> connections = new HashMap<>();

    record Ticket(String code, String token, String seat) {}
    record Cell(int row, int col) {}
    record Move(int row, int col, String mark) {}
    record Connection(Room room, Player player) {}
    record PlayerView(String seat, String name, boolean online, boolean rematch) {}

    static final class Player {
        final String seat;
        final String name;
        final String token = UUID.randomUUID().toString();
        final Map<String, WebSocketSession> sockets = new HashMap<>();
        boolean rematch;

        Player(String seat, String name) {
            this.seat = seat;
            this.name = name;
        }

        PlayerView view() {
            return new PlayerView(seat, name, !sockets.isEmpty(), rematch);
        }
    }

    static final class Room {
        final String code;
        final Player host;
        Player guest;
        int round = 1;
        String turn = "X";
        String winner;
        List<Cell> winning = List.of();
        String[][] board = new String[SIZE][SIZE];
        final List<Move> moves = new ArrayList<>();
        long lastActive = System.currentTimeMillis();

        Room(String code, Player host) {
            this.code = code;
            this.host = host;
        }

        List<Player> players() {
            return guest == null ? List.of(host) : List.of(host, guest);
        }

        boolean finished() {
            return winner != null || moves.size() == SIZE * SIZE;
        }

        void reset() {
            round++;
            turn = round % 2 == 0 ? "O" : "X";
            winner = null;
            winning = List.of();
            board = new String[SIZE][SIZE];
            moves.clear();
            players().forEach(player -> player.rematch = false);
        }

        Map<String, Object> state() {
            Map<String, Object> state = new LinkedHashMap<>();
            state.put("type", "state");
            state.put("code", code);
            state.put("players", players().stream().map(Player::view).toList());
            state.put("round", round);
            state.put("turn", turn);
            state.put("status", guest == null ? "waiting" : finished() ? "finished" : "playing");
            state.put("moves", moves);
            state.put("winner", winner);
            state.put("winning", winning);
            return state;
        }
    }

    GameServer(ObjectMapper json) {
        this.json = json;
    }

    synchronized Ticket create(String rawName) {
        String name = playerName(rawName);
        if (rooms.size() >= 500) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Máy chủ đang đầy. Vui lòng thử lại.");
        }
        String code;
        do {
            StringBuilder candidate = new StringBuilder();
            for (int i = 0; i < 5; i++) {
                candidate.append(ROOM_ALPHABET.charAt(random.nextInt(ROOM_ALPHABET.length())));
            }
            code = candidate.toString();
        } while (rooms.containsKey(code));
        Room room = new Room(code, new Player("X", name));
        rooms.put(code, room);
        return new Ticket(code, room.host.token, room.host.seat);
    }

    synchronized Ticket join(String rawCode, String rawName) {
        String name = playerName(rawName);
        String code = rawCode.toUpperCase(Locale.ROOT);
        Room room = rooms.get(code);
        if (room == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Phòng không tồn tại.");
        }
        if (room.guest != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Phòng đã đủ hai người.");
        }
        room.guest = new Player("O", name);
        broadcast(room);
        return new Ticket(code, room.guest.token, room.guest.seat);
    }

    private String playerName(String raw) {
        String name = raw == null ? "" : raw.strip();
        if (name.isEmpty() || name.length() > 24) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Tên phải có từ 1 đến 24 ký tự.");
        }
        return name;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession socket) {
        socket.setTextMessageSizeLimit(2048);
    }

    @Override
    protected synchronized void handleTextMessage(WebSocketSession socket, TextMessage message) throws IOException {
        JsonNode input;
        try {
            input = json.readTree(message.getPayload());
        } catch (IOException invalid) {
            error(socket, "Yêu cầu không hợp lệ.");
            return;
        }
        if (input == null || !input.isObject()) {
            error(socket, "Yêu cầu không hợp lệ.");
            return;
        }
        String type = input.path("type").asText();
        Connection connection = connections.get(socket.getId());
        if (connection == null) {
            if ("hello".equals(type)) {
                connect(socket, input.path("code").asText(), input.path("token").asText());
            } else {
                socket.close(CloseStatus.POLICY_VIOLATION);
            }
            return;
        }
        Room room = connection.room();
        Player player = connection.player();
        switch (type) {
            case "move" -> move(socket, room, player, input);
            case "rematch" -> {
                if (room.finished()) {
                    player.rematch = true;
                    if (room.players().stream().allMatch(p -> p.rematch)) {
                        room.reset();
                    }
                    broadcast(room);
                }
            }
            case "leave" -> closeRoom(room, player);
            default -> error(socket, "Yêu cầu không hợp lệ.");
        }
    }

    private void connect(WebSocketSession socket, String code, String token) throws IOException {
        Room room = rooms.get(code);
        if (room != null) {
            for (Player player : room.players()) {
                if (player.token.equals(token)) {
                    connections.put(socket.getId(), new Connection(room, player));
                    player.sockets.put(socket.getId(), socket);
                    broadcast(room);
                    return;
                }
            }
        }
        send(socket, Map.of("type", "closed", "message", "Phòng hoặc phiên chơi đã hết hạn."));
        socket.close(CloseStatus.NORMAL);
    }

    private void move(WebSocketSession socket, Room room, Player player, JsonNode input) {
        int row = integer(input.path("row"));
        int col = integer(input.path("col"));
        if (room.guest == null || room.finished() || !room.turn.equals(player.seat)
                || integer(input.path("round")) != room.round
                || integer(input.path("ply")) != room.moves.size()
                || !inBounds(row, col) || room.board[row][col] != null) {
            error(socket, "Nước đi không hợp lệ hoặc bàn cờ đã thay đổi.");
            send(socket, room.state());
            return;
        }
        String mark = player.seat;
        room.board[row][col] = mark;
        room.moves.add(new Move(row, col, mark));
        room.winning = winningLine(room.board, row, col, mark);
        if (!room.winning.isEmpty()) {
            room.winner = mark;
        } else {
            room.turn = mark.equals("X") ? "O" : "X";
        }
        broadcast(room);
    }

    private static int integer(JsonNode value) {
        return value.isIntegralNumber() && value.canConvertToInt() ? value.intValue() : -1;
    }

    private static boolean inBounds(int row, int col) {
        return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
    }

    private static List<Cell> winningLine(String[][] board, int row, int col, String mark) {
        int[][] directions = {{0, 1}, {1, 0}, {1, 1}, {1, -1}};
        for (int[] direction : directions) {
            int dr = direction[0];
            int dc = direction[1];
            int r = row;
            int c = col;
            while (inBounds(r - dr, c - dc) && mark.equals(board[r - dr][c - dc])) {
                r -= dr;
                c -= dc;
            }
            List<Cell> line = new ArrayList<>();
            while (inBounds(r, c) && mark.equals(board[r][c])) {
                line.add(new Cell(r, c));
                r += dr;
                c += dc;
            }
            if (line.size() >= 5) {
                return line;
            }
        }
        return List.of();
    }

    private void broadcast(Room room) {
        room.lastActive = System.currentTimeMillis();
        Map<String, Object> state = room.state();
        for (Player player : room.players()) {
            for (WebSocketSession socket : List.copyOf(player.sockets.values())) {
                send(socket, state);
            }
        }
    }

    private void closeRoom(Room room, Player leaving) {
        rooms.remove(room.code);
        for (Player player : room.players()) {
            String message = player == leaving ? "Bạn đã rời phòng." : "Đối thủ đã rời phòng.";
            for (WebSocketSession socket : List.copyOf(player.sockets.values())) {
                connections.remove(socket.getId());
                send(socket, Map.of("type", "closed", "message", message));
                close(socket);
            }
            player.sockets.clear();
        }
    }

    private void error(WebSocketSession socket, String message) {
        send(socket, Map.of("type", "error", "message", message));
    }

    private void send(WebSocketSession socket, Map<String, Object> payload) {
        try {
            if (socket.isOpen()) {
                socket.sendMessage(new TextMessage(json.writeValueAsString(payload)));
            }
        } catch (IOException | IllegalStateException disconnected) {
            close(socket);
        }
    }

    private void close(WebSocketSession socket) {
        try {
            socket.close();
        } catch (IOException ignored) {
            // The transport is already unavailable.
        }
    }

    @Override
    public synchronized void afterConnectionClosed(WebSocketSession socket, CloseStatus status) {
        Connection connection = connections.remove(socket.getId());
        if (connection != null) {
            connection.player().sockets.remove(socket.getId());
            broadcast(connection.room());
        }
    }

    @Scheduled(fixedDelay = 60_000)
    synchronized void removeIdleRooms() {
        long cutoff = System.currentTimeMillis() - IDLE_LIMIT;
        rooms.values().removeIf(room -> room.lastActive < cutoff
                && room.players().stream().allMatch(player -> player.sockets.isEmpty()));
    }
}
