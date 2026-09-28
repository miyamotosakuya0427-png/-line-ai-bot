const http = require("http");

const crypto = require("crypto");

const PORT = process.env.PORT || 3000;

/* =====================================================

   OpenAI

===================================================== */

async function getAIReply(message) {

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

            role: "user",

            content: [

              {

                type: "input_text",

                text: message

              }

            ]

          }

        ]

      })

    }

  );

  const data = await response.json();

  console.log(

    "OpenAI STATUS:",

    response.status

  );

  console.log(

    "OpenAI RESPONSE:",

    JSON.stringify(data)

  );

  /* ---------------------------------------------

     OpenAI APIエラー

  --------------------------------------------- */

  if (!response.ok) {

    console.error(

      "OpenAI API ERROR:",

      JSON.stringify(data)

    );

    throw new Error(

      data?.error?.message ||

      "OpenAI API error"

    );

  }

  /* ---------------------------------------------

     ① 新しいResponses APIのoutput_text

  --------------------------------------------- */

  if (

    typeof data.output_text === "string" &&

    data.output_text.trim()

  ) {

    return data.output_text.trim();

  }

  /* ---------------------------------------------

     ② output → message → content → text

  --------------------------------------------- */

  if (Array.isArray(data.output)) {

    for (const outputItem of data.output) {

      if (

        outputItem &&

        outputItem.type === "message" &&

        Array.isArray(outputItem.content)

      ) {

        for (const contentItem of outputItem.content) {

          if (

            contentItem &&

            contentItem.type === "output_text" &&

            typeof contentItem.text === "string"

          ) {

            if (contentItem.text.trim()) {

              return contentItem.text.trim();

            }

          }

        }

      }

    }

  }

  /* ---------------------------------------------

     ③ 念のためoutput全体からtextを探す

  --------------------------------------------- */

  if (Array.isArray(data.output)) {

    for (const outputItem of data.output) {

      if (

        outputItem &&

        Array.isArray(outputItem.content)

      ) {

        for (const contentItem of outputItem.content) {

          if (

            contentItem &&

            typeof contentItem.text === "string" &&

            contentItem.text.trim()

          ) {

            return contentItem.text.trim();

          }

        }

      }

    }

  }

  /* ---------------------------------------------

     回答が見つからない

  --------------------------------------------- */

  console.error(

    "OpenAIの回答テキストを取得できませんでした:",

    JSON.stringify(data)

  );

  throw new Error(

    "OpenAI response text not found"

  );

}

/* =====================================================

   LINE署名確認

===================================================== */

function verifySignature(body, signature) {

  const secret = process.env.LINE_CHANNEL_SECRET;

  if (!secret) {

    console.error(

      "LINE_CHANNEL_SECRET が設定されていません"

    );

    return false;

  }

  const hash = crypto

    .createHmac(

      "sha256",

      secret

    )

    .update(body)

    .digest("base64");

  return hash === signature;

}

/* =====================================================

   LINEへ返信

===================================================== */

async function replyToLINE(

  replyToken,

  text

) {

  const accessToken =

    process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) {

    throw new Error(

      "LINE_CHANNEL_ACCESS_TOKEN が設定されていません"

    );

  }

  const replyText =

    String(text || "")

      .trim()

      .slice(0, 5000);

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

            text:

              replyText ||

              "申し訳ありません。回答を取得できませんでした。"

          }

        ]

      })

    }

  );

  const data = await response.text();

  console.log(

    "LINE STATUS:",

    response.status

  );

  console.log(

    "LINE RESPONSE:",

    data

  );

  if (!response.ok) {

    throw new Error(

      `LINE API error: ${response.status} ${data}`

    );

  }

  return data;

}

/* =====================================================

   HTTPサーバー

===================================================== */

const server = http.createServer(

  (req, res) => {

    /* ---------------------------------------------

       GET

    --------------------------------------------- */

    if (req.method === "GET") {

      res.writeHead(

        200,

        {

          "Content-Type":

            "text/plain; charset=utf-8"

        }

      );

      res.end(

        "株式会社One LINE AI Bot is running"

      );

      return;

    }

    /* ---------------------------------------------

       POST /webhook 以外

    --------------------------------------------- */

    if (

      req.method !== "POST" ||

      req.url !== "/webhook"

    ) {

      res.writeHead(404);

      res.end("Not Found");

      return;

    }

    /* ---------------------------------------------

       POST本文取得

    --------------------------------------------- */

    let body = "";

    req.on(

      "data",

      chunk => {

        body += chunk.toString();

        /* LINE webhookのサイズ制限対策 */

        if (body.length > 1000000) {

          req.destroy();

          return;

        }

      }

    );

    req.on(

      "end",

      async () => {

        try {

          /* ---------------------------------------

             LINE署名確認

          --------------------------------------- */

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

              "LINE signature verification failed"

            );

            res.writeHead(401);

            res.end("Unauthorized");

            return;

          }

          /* ---------------------------------------

             LINEにはすぐ200を返す

          --------------------------------------- */

          res.writeHead(

            200,

            {

              "Content-Type":

                "text/plain; charset=utf-8"

            }

          );

          res.end("OK");

          /* ---------------------------------------

             JSON解析

          --------------------------------------- */

          const data =

            JSON.parse(body);

          console.log(

            "LINE WEBHOOK:",

            JSON.stringify(data)

          );

          /* ---------------------------------------

             イベント処理

          --------------------------------------- */

          for (

            const event

            of data.events || []

          ) {

            /* -------------------------------------

               テキストメッセージだけ処理

            ------------------------------------- */

            if (

              event.type !== "message" ||

              !event.message ||

              event.message.type !== "text"

            ) {

              continue;

            }

            const userMessage =

              event.message.text;

            console.log(

              "LINE MESSAGE:",

              userMessage

            );

            /* -------------------------------------

               replyToken確認

            ------------------------------------- */

            if (!event.replyToken) {

              console.error(

                "replyToken がありません"

              );

              continue;

            }

            /* -------------------------------------

               AI回答取得

            ------------------------------------- */

            try {

              const aiReply =

                await getAIReply(

                  userMessage

                );

              console.log(

                "AI REPLY:",

                aiReply

              );

              /* -----------------------------------

                 LINE返信

              ----------------------------------- */

              await replyToLINE(

                event.replyToken,

                aiReply

              );

              console.log(

                "LINEへの返信成功"

              );

            } catch (error) {

              console.error(

                "AI PROCESSING ERROR:",

                error

              );

              /* -----------------------------------

                 エラー時もLINEへ通知

              ----------------------------------- */

              try {

                await replyToLINE(

                  event.replyToken,

                  "申し訳ありません。AIの回答処理中にエラーが発生しました。"

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

            "SERVER ERROR:",

            error

          );

        }

      }

    );

  }

);

/* =====================================================

   サーバー起動

===================================================== */

server.listen(

  PORT,

  () => {

    console.log(

      `Server running on port ${PORT}`

    );

  }

);