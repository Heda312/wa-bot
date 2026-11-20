import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import QRCode from "qrcode";

export interface WaClient {
  sendText(phone: string, text: string): Promise<void>;
}

export async function createWaClient(
  sessionDir: string,
  log: Logger,
): Promise<WaClient> {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  let sock: WASocket | undefined;
  let readyResolve: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const connect = async (): Promise<void> => {
    sock = makeWASocket({ auth: state, printQRInTerminal: false });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (update) => {
      if (update.qr) {
        const qr = await QRCode.toString(update.qr, {
          type: "terminal",
          small: true,
        });
        log.info("\n%s\nScan QR di atas pakai WhatsApp nomor bot", qr);
      }
      if (update.connection === "open") {
        log.info("WhatsApp terhubung");
        readyResolve();
      }
      if (update.connection === "close") {
        const code = (
          update.lastDisconnect?.error as
            | { output?: { statusCode?: number } }
            | undefined
        )?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          log.error(
            "Session logged out. Hapus isi folder session, restart, scan QR ulang.",
          );
          process.exit(1);
        }
        log.warn({ code }, "Koneksi WA tertutup, reconnect dalam 3 detik");
        setTimeout(() => void connect(), 3000);
      }
    });
  };

  await connect();

  return {
    async sendText(phone, text) {
      await ready;
      if (!sock) throw new Error("Socket WA belum siap");
      await sock.sendMessage(`${phone}@s.whatsapp.net`, { text });
    },
  };
}
