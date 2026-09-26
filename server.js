const http = require("http");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

/* =====================================================
 * 株式会社One
 * LINE × OpenAI AI BOT
 * ===================================================== */


/* =====================================================
 * OpenAI AI回答
 * ===================================================== */

async function getAIReply(message) {

  console.log("===== OpenAI REQUEST =====");
  console.log("MESSAGE:", message);

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY が設定されていません");
  }

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },

      body: JSON.stringify({

        model: "gpt-5.6-luna",

        input: [
          {
            role: "system",
            content:
              "あなたは株式会社OneのAIアシスタントです。" +
              "日本語で分かりやすく丁寧に回答してください。" +
              "建設業、土木工事、電気工事、太陽光、蓄電池、見積、原価、売上、利益、経費、日報などについても実務的に対応してください。" +
              "分からないことは推測せず、分からないと伝えてください。"
          },
          {
            role: "user",
            content: String(message)
          }
        ]

      })
    }
  );


  /* ===================================================
   * OpenAIレスポンス取得
   * =================================================== */

  const data = await response.json();


  console.log("===== OPENAI STATUS =====");
  console.log("STATUS:", response.status);


  if (!response.ok) {

    console.error(
      "OPENAI API ERROR:",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      data?.error?.message ||
      "OpenAI API error"
    );
  }


  console.log(
    "OPENAI RESPONSE:",
    JSON.stringify(data, null, 2)
  );


  /* ===================================================
   * 回答テキストを取得
   *
   * output_text がある場合
   * ↓
   * それを使用
   *
   * output_text がない場合
   * ↓
   * output の中から output_text を探す
   * =================================================== */

  let answer = "";


  // ① output_text
  if (
    typeof data.output_text === "string" &&
    data.output_text.trim()
  ) {

    answer = data.output_text.trim();

  }


  // ② output 配列から取得
  if (!answer && Array.isArray(data.output)) {

    const texts = [];

    for (const item of data.output) {

      if (!item) {
        continue;
      }


      // message
      if (
        item.type === "message" &&
        Array.isArray(item.content)
      ) {

        for (const content of item.content) {

          if (
            content &&
            content.type === "output_text" &&
            typeof content.text === "string"
          ) {

            texts.push(content.text);
          }

        }
      }


      // 念のため直接textも確認
      if (
        typeof item.text === "string" &&
        item.text.trim()
      ) {

        texts.push(item.text);
      }

    }

    answer = texts.join("\n").trim();
  }


  // ③ それでも取得できない場合
  if (!answer) {

    console.error(
      "AI回答テキストを取得できませんでした。",
      JSON.stringify(data, null, 2)
    );

    throw new Error(
      "OpenAIから回答テキストを取得できませんでした"
    );
  }


  console.log("===== AI ANSWER =====");
  console.log(answer);


  return answer;
}


/* =====================================================
 * LINE署名確認
 * ===================================================== */

function verifySignature(body, signature) {

  const secret = process.env.LINE_CHANNEL_SECRET;

  if (!secret) {
    console.error(
      "LINE_CHANNEL_SECRET が設定されていません"
    );

    return false;
  }


  const hash = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64");


  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(signature)
  );
}


/* =====================================================
 * LINEへ返信
 * ===================================================== */

async function replyToLINE(replyToken, text) {

  const accessToken =
    process.env.LINE_CHANNEL_ACCESS_TOKEN;


  if (!accessToken) {

    throw new Error(
      "LINE_CHANNEL_ACCESS_TOKEN が設定されていません"
    );
  }


  // LINEは1メッセージ最大5000文字
  const replyText =
    String(text || "回答を取得できませんでした。")
      .slice(0, 5000);


  console.log("===== LINE REPLY =====");
  console.log(replyText);


  const response = await fetch(
    "https://api.line.me/v2/bot/message/reply",
    {

      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "Authorization":
          `Bearer ${accessToken}`
      },

      body: JSON.stringify({

        replyToken: replyToken,

        messages: [
          {
            type: "text",
            text: replyText
          }
        ]

      })

    }
  );


  const resultText =
    await response.text();


  console.log(
    "LINE RESPONSE STATUS:",
    response.status
  );

  console.log(
    "LINE RESPONSE:",
    resultText
  );


  if (!response.ok) {

    throw new Error(
      `LINE API ERROR ${response.status}: ${resultText}`
    );
  }

}


/* =====================================================
 * HTTPサーバー
 * ===================================================== */

const server = http.createServer(
  (req, res) => {


    /* ===============================================
     * GET
     *
     * Renderの動作確認用
     * =============================================== */

    if (req.method === "GET") {

      res.writeHead(
        200,
        {
          "Content-Type":
            "text/plain; charset=utf-8"
        }
      );

      res.end(
        "株式会社One LINE AI Bot is running."
      );

      return;
    }


    /* ===============================================
     * POST /webhook
     * =============================================== */

    if (
      req.method !== "POST" ||
      req.url !== "/webhook"
    ) {

      res.writeHead(404);

      res.end("Not Found");

      return;
    }


    let body = "";


    /* ===============================================
     * POSTデータ受信
     * =============================================== */

    req.on(
      "data",
      chunk => {

        body += chunk.toString();

      }
    );


    req.on(
      "end",
      async () => {

        try {


          /* =========================================
           * LINE署名確認
           * ========================================= */

          const signature =
            req.headers["x-line-signature"];


          if (
            !signature ||
            !verifySignature(
              body,
              signature
            )
          ) {

            console.error(
              "LINE SIGNATURE ERROR"
            );

            res.writeHead(401);

            res.end("Unauthorized");

            return;
          }


          /* =========================================
           * LINEへ即時200
           *
           * LINEのWebhookタイムアウトを防ぐ
           * ========================================= */

          res.writeHead(
            200,
            {
              "Content-Type":
                "text/plain; charset=utf-8"
            }
          );

          res.end("OK");


          /* =========================================
           * JSON解析
           * ========================================= */

          const data =
            JSON.parse(body);


          console.log(
            "===== LINE WEBHOOK ====="
          );

          console.log(
            JSON.stringify(
              data,
              null,
              2
            )
          );


          /* =========================================
           * LINEイベント処理
           * ========================================= */

          for (
            const event of
            data.events || []
          ) {


            /* =======================================
             * テキストメッセージのみ処理
             * ======================================= */

            if (
              event.type !== "message" ||
              !event.message ||
              event.message.type !== "text"
            ) {

              continue;
            }


            const userMessage =
              event.message.text;


            const replyToken =
              event.replyToken;


            console.log(
              "===== LINE MESSAGE ====="
            );

            console.log(
              userMessage
            );


            /* =======================================
             * AI回答
             * ======================================= */

            try {

              const aiReply =
                await getAIReply(
                  userMessage
                );


              /* =====================================
               * LINE返信
               * ===================================== */

              await replyToLINE(
                replyToken,
                aiReply
              );


              console.log(
                "===== SUCCESS ====="
              );


            } catch (error) {


              console.error(
                "===== AI PROCESSING ERROR ====="
              );

              console.error(
                error
              );


              /* =====================================
               * エラー時LINE返信
               * ===================================== */

              try {

                await replyToLINE(
                  replyToken,
                  "申し訳ありません。\n現在AIの回答処理でエラーが発生しています。\nしばらくしてからもう一度お試しください。"
                );

              } catch (lineError) {

                console.error(
                  "LINE ERROR:",
                  lineError
                );

              }

            }

          }


        } catch (error) {

          console.error(
            "===== SERVER ERROR ====="
          );

          console.error(
            error
          );

        }

      }
    );

  }
);


/* =====================================================
 * サーバー起動
 * ===================================================== */

server.listen(
  PORT,
  () => {

    console.log(
      "================================="
    );

    console.log(
      "株式会社One LINE AI Bot"
    );

    console.log(
      `Server running on port ${PORT}`
    );

    console.log(
      "OpenAI model: gpt-5.6-luna"
    );

    console.log(
      "Webhook: /webhook"
    );

    console.log(
      "================================="
    );

  }
);