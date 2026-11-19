import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Board } from './Board';
import type { Cell, Move, Seat } from './Board';
import './styles.css';

type Ticket = { code: string; token: string; seat: Seat };
type Player = { seat: Seat; name: string; online: boolean; rematch: boolean };
type Room = {
  type: 'state'; code: string; players: Player[]; round: number; turn: Seat;
  status: 'waiting' | 'playing' | 'finished'; moves: Move[]; winner: Seat | null; winning: Cell[];
};
type RoomMessage = Room | { type: 'error' | 'closed'; message: string };
const storageKey = 'caro-online-ticket';

function restoreTicket(): Ticket | null {
  try {
    const ticket: Ticket | null = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    return ticket?.code && ticket.token && ['X', 'O'].includes(ticket.seat) ? ticket : null;
  } catch {
    return null;
  }
}

function storeTicket(ticket: Ticket | null) {
  try {
    if (ticket) sessionStorage.setItem(storageKey, JSON.stringify(ticket));
    else sessionStorage.removeItem(storageKey);
  } catch {
    // A browser with storage disabled can still play the current session.
  }
}

function App() {
  const [ticket, setTicket] = useState(restoreTicket);
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const leaving = useRef(false);

  function reset(message: string) {
    setTicket(null);
    setRoom(null);
    setConnected(false);
    setCopied(false);
    setNotice(message);
    storeTicket(null);
  }

  useEffect(() => {
    if (!ticket) return;
    leaving.current = false;
    let disposed = false;
    let closedByServer = false;
    let retry: number | undefined;
    let attempt = 0;

    function connect() {
      if (disposed || leaving.current || !ticket) return;
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', ...ticket }));
      socket.onmessage = event => {
        if (disposed) return;
        const message: RoomMessage = JSON.parse(event.data);
        if (message.type === 'state') {
          setRoom(message);
          setConnected(true);
          attempt = 0;
        } else if (message.type === 'closed') {
          closedByServer = true;
          leaving.current = true;
          reset(message.message);
        } else {
          setNotice(message.message);
        }
      };
      socket.onclose = () => {
        if (disposed || closedByServer) return;
        setConnected(false);
        if (leaving.current) {
          reset('Bạn đã rời phòng.');
        } else {
          retry = window.setTimeout(connect, Math.min(1000 * 2 ** attempt++, 5000));
        }
      };
      socket.onerror = () => socket.close();
    }

    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [ticket]);

  async function enter(event: FormEvent<HTMLFormElement>, joining: boolean) {
    event.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setNotice('Hãy nhập tên hiển thị.');
      return;
    }
    if (joining && !/^[A-Z2-9]{5}$/.test(code.trim())) {
      setNotice('Hãy nhập mã phòng gồm 5 ký tự.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const url = joining ? `/api/rooms/${encodeURIComponent(code.trim())}/join` : '/api/rooms';
      const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Không thể vào phòng.');
      storeTicket(payload);
      setTicket(payload);
    } catch (error) {
      setNotice(error instanceof Error && error.message !== 'Failed to fetch'
        ? error.message : 'Không thể kết nối máy chủ.');
    } finally {
      setBusy(false);
    }
  }

  function send(payload: Record<string, unknown>) {
    const socket = socketRef.current;
    if (!connected || socket?.readyState !== WebSocket.OPEN) return false;
    setNotice('');
    socket.send(JSON.stringify(payload));
    return true;
  }

  function leave() {
    leaving.current = true;
    if (!send({ type: 'leave' })) reset('Bạn đã rời phòng.');
  }

  async function copyCode() {
    if (!ticket) return;
    try {
      await navigator.clipboard.writeText(ticket.code);
      setCopied(true);
    } catch {
      setNotice(`Mã phòng của bạn là ${ticket.code}.`);
    }
  }

  if (!ticket) return <main className="lobby">
    <section className="panel lobby-card">
      <div className="brand-marks" aria-hidden="true"><span>×</span><span>○</span></div>
      <h1>Cờ Caro Online</h1>
      <p className="intro">Tạo phòng và mời bạn bè chơi cùng.</p>
      <label htmlFor="name">Tên hiển thị</label>
      <input id="name" autoComplete="nickname" maxLength={24} value={name}
        onChange={event => setName(event.target.value)} placeholder="Nhập tên của bạn" />
      <form onSubmit={event => enter(event, false)}>
        <button className="primary full" disabled={busy}>Tạo phòng</button>
      </form>
      <div className="divider"><span>hoặc</span></div>
      <form onSubmit={event => enter(event, true)}>
        <label htmlFor="code">Mã phòng</label>
        <input id="code" maxLength={5} value={code} autoCapitalize="characters" autoComplete="off"
          onChange={event => setCode(event.target.value.toUpperCase())} placeholder="Nhập mã phòng" />
        <button className="secondary full" disabled={busy}>Vào phòng</button>
      </form>
      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
  </main>;

  const me = room?.players.find(player => player.seat === ticket.seat);
  const other = room?.players.find(player => player.seat !== ticket.seat);
  const canPlay = connected && room?.status === 'playing' && room.turn === ticket.seat;
  let status = 'Đang kết nối…';
  if (connected && room) {
    if (room.status === 'waiting') status = 'Đang chờ đối thủ';
    else if (room.status === 'finished') status = !room.winner ? 'Hòa cờ' : room.winner === ticket.seat ? 'Bạn thắng!' : 'Đối thủ thắng';
    else status = canPlay ? 'Đến lượt bạn' : 'Đến lượt đối thủ';
  }

  return <main className="game">
    <header className="game-header">
      <h1>Cờ Caro Online</h1>
      <button className="secondary" type="button" onClick={leave}>Rời phòng</button>
    </header>
    <section className="panel game-card">
      <div className="room-bar">
        <div>Mã phòng <strong>{ticket.code}</strong></div>
        <button className="secondary" type="button" onClick={copyCode}>{copied ? 'Đã sao chép' : 'Sao chép mã'}</button>
      </div>
      <div className="players">
        {(['X', 'O'] as const).map(seat => {
          const player = room?.players.find(item => item.seat === seat);
          return <div key={seat} className={`player ${room?.status === 'playing' && room.turn === seat ? 'active' : ''}`}>
            <span className={`mark ${seat.toLowerCase()}`}>{seat}</span>
            <div><strong>{player?.name ?? 'Đang chờ'}</strong>
              <small>{seat === ticket.seat ? 'Bạn' : player ? player.online ? 'Đối thủ' : 'Mất kết nối' : 'Chỗ trống'}</small>
            </div>
          </div>;
        })}
      </div>
      <div className="game-status" role="status">
        <strong>{status}</strong>
        {connected && room?.status === 'waiting' && <span>Gửi mã phòng cho bạn bè để bắt đầu.</span>}
        {connected && room?.status === 'playing' && other && !other.online && <span>Đối thủ đang mất kết nối.</span>}
        {notice && <span className="notice">{notice}</span>}
      </div>
      <Board key={room?.round ?? 1} moves={room?.moves ?? []} winning={room?.winning ?? []}
        canPlay={canPlay} onMove={cell => room && send({ type: 'move', ...cell, round: room.round, ply: room.moves.length })} />
      {room?.status === 'finished' && <div className="rematch">
        {other?.rematch && <span>Đối thủ muốn chơi lại.</span>}
        <button className="primary" type="button" disabled={!connected || me?.rematch}
          onClick={() => send({ type: 'rematch' })}>{me?.rematch ? 'Đang chờ đối thủ' : 'Chơi lại'}</button>
      </div>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
