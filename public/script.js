// ============================================================
// Konfigurasi
// ============================================================
const API_URL = "/api/chat";

// Instruksi awal untuk model. Silakan ubah sesuai kebutuhan.
const SYSTEM_PROMPT =
  "Kamu adalah asisten virtual yang ramah, sopan, dan informatif. " +
  "Jawab dalam bahasa Indonesia yang baik dan ringkas. " +
  "Jika tidak yakin dengan suatu informasi, katakan terus terang.";

// Riwayat percakapan dikirim ke server dalam bentuk array `messages`.
const history = [{ role: "system", content: SYSTEM_PROMPT }];

const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("message-input");
const buttonEl = document.getElementById("send-button");

// ---------- Utilitas ----------
function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Mengubah **teks tebal** dan baris baru menjadi HTML yang aman.
function formatText(text) {
  return escapeHTML(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

// Mengambil teks dari berbagai bentuk data: string biasa (format index.js),
// atau objek gaya OpenRouter/OpenAI (delta.content / message.content).
function extractText(value) {
  if (typeof value === "string") return value;
  const choice = value?.choices?.[0];
  return choice?.delta?.content ?? choice?.message?.content ?? value?.content ?? "";
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Mengembalikan elemen bubble agar isinya bisa diperbarui saat streaming.
function addMessage(text, sender = "bot", extraClass = "") {
  const wrapper = document.createElement("div");
  wrapper.className = `msg msg--${sender} ${extraClass}`.trim();

  if (sender === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "msg__avatar";
    avatar.textContent = "🤖";
    avatar.setAttribute("aria-hidden", "true");
    wrapper.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg__bubble";
  bubble.innerHTML = formatText(text);
  wrapper.appendChild(bubble);

  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return { wrapper, bubble };
}

function showTyping() {
  const wrapper = document.createElement("div");
  wrapper.className = "msg msg--bot";
  wrapper.innerHTML = `
    <div class="msg__avatar" aria-hidden="true">🤖</div>
    <div class="msg__bubble">
      <span class="typing" aria-label="Chatbot sedang mengetik">
        <span></span><span></span><span></span>
      </span>
    </div>`;
  messagesEl.appendChild(wrapper);
  scrollToBottom();
  return wrapper;
}

function setLoading(isLoading) {
  buttonEl.disabled = isLoading;
  inputEl.disabled = isLoading;
  if (!isLoading) inputEl.focus();
}

// ---------- Kirim pesan & baca streaming ----------
async function sendMessage(text) {
  addMessage(text, "user");
  history.push({ role: "user", content: text });

  setLoading(true);
  const typing = showTyping();

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });

    if (!response.ok) throw new Error(`Server merespons ${response.status}`);

    // Cadangan: jika server membalas JSON biasa (bukan streaming)
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await response.json();
      const reply = extractText(json);
      typing.remove();
      if (reply) {
        addMessage(reply, "bot");
        history.push({ role: "assistant", content: reply });
      } else {
        addMessage("Maaf, saya belum menemukan jawaban yang tepat.", "bot");
        history.pop();
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let fullReply = "";
    let bubble = null;
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Event SSE dipisah baris baru; sisa baris yang belum lengkap disimpan.
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          finished = true;
          break;
        }

        let parsed;
        try {
          parsed = JSON.parse(data); // server mengirim string ber-JSON
        } catch {
          parsed = data;
        }

        const chunk = extractText(parsed);
        if (!chunk) continue;

        // Saat potongan pertama tiba, ganti indikator mengetik dengan bubble.
        if (!bubble) {
          typing.remove();
          bubble = addMessage("", "bot").bubble;
        }

        fullReply += chunk;
        bubble.innerHTML = formatText(fullReply);
        scrollToBottom();
      }
    }

    if (!bubble) {
      typing.remove();
      addMessage("Maaf, saya belum menemukan jawaban yang tepat.", "bot");
      history.pop(); // buang pesan pengguna agar bisa dicoba lagi
    } else {
      history.push({ role: "assistant", content: fullReply });
    }
  } catch (error) {
    console.error(error);
    typing.remove();
    history.pop(); // buang pesan pengguna yang gagal diproses
    addMessage(
      "Mohon maaf, saya sedang kesulitan terhubung ke server. Silakan coba kirim ulang sebentar lagi ya. 🙏",
      "bot",
      "msg--error"
    );
  } finally {
    setLoading(false);
  }
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  sendMessage(text);
});

// ---------- Sapaan awal (hanya tampilan, tidak dikirim ke model) ----------
addMessage(
  "Halo! 👋 Saya **Chatbot**, asisten virtual Anda.\nSilakan ketik pertanyaan di bawah, saya siap membantu dengan senang hati.",
  "bot"
);