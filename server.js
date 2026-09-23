const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

async function getAIReply(message) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      input: message
    })
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("OpenAI ERROR:", JSON.stringify(data));
    throw new Error("OpenAI API error");
  }

  console.log("OpenAI RESPONSE:", JSON.stringify(data));

  return data.output_text || "回答を取得できませんでした。";
}

function verifySignature(body, signature) {
  const hash = crypto
    .createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest("base64");

  return hash === signature;
}

async function replyToLINE(replyToken, text) {
  const response = await fetch(
    "https://api.line.me/v2/bot/message/reply",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        replyToken: replyToken,
        messages: [
          {
            type: "text",
            text: String(text).slice(0, 5000)
          }
        ]
      })
    }
  );

  const data = await response.text();
  console.log("LINE RESPONSE:", data);
}

const server = http.createServer((req, res) => {

  if (req.method === "GET") {
    res.writeHead(200);
    res.end("LINE AI Bot is running");
    return;
  }

  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  let body = "";

  req.on("data", chunk => {
    body += chunk;
  });

  req.on("end", async () => {

    try {
      const signature = req.headers["x-line-signature"];

      if (!signature || !verifySignature(body, signature)) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }

      res.writeHead(200);
      res.end("OK");

      const data = JSON.parse(body);

      for (const event of data.events || []) {

        if (
          event.type === "message" &&
          event.message &&
          event.message.type === "text"
        ) {

          console.log("LINE MESSAGE:", event.message.text);

          try {
            const aiReply = await getAIReply(event.message.text);

            await replyToLINE(
              event.replyToken,
              aiReply
            );

          } catch (error) {

            console.error("AI ERROR:", error);

            await replyToLINE(
              event.replyToken,
              "申し訳ありません。現在AIの回答を取得できません。"
            );
          }
        }
      }

    } catch (error) {
      console.error("SERVER ERROR:", error);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});