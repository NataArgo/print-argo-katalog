// netlify/functions/embed.js
//
// Що робить цей файл:
// Браузер відвідувача НЕ звертається до Google напряму (бо тоді довелось би
// показати йому наш секретний ключ). Замість цього браузер звертається
// сюди, на наш власний маленький сервер (Netlify Function), а вже ЦЯ
// функція, маючи ключ у собі (і ніде більше), йде в Google, отримує
// відповідь і повертає її браузеру. Ключ ніколи не потрапляє в код сторінки.

// Звідки дозволено звертатись до цієї функції.
// print-argo.com — робочий сайт на GitHub Pages, звідти й підуть реальні запити.
const ALLOWED_ORIGIN = 'https://print-argo.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  // Браузер перед "справжнім" запитом з іншого домену сам надсилає
  // технічний OPTIONS-запит, щоб перевірити дозвіл. Відповідаємо на нього одразу.
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  // Дозволяємо запити тільки методом POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  // Ключ читається зі змінної середовища Netlify, а не з коду —
  // це і є те місце, де він лишається прихованим.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'GEMINI_API_KEY не налаштований на сервері' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Некоректний JSON у запиті' }) };
  }

  const { imageBase64, mimeType } = payload;
  if (!imageBase64) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Не передано imageBase64' }) };
  }

  try {
    const googleRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          content: {
            parts: [{ inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }],
          },
          outputDimensionality: 768,
        }),
      }
    );

    const text = await googleRes.text();
    if (!googleRes.ok) {
      return {
        statusCode: googleRes.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Помилка від Google: ' + text.slice(0, 300) }),
      };
    }

    const data = JSON.parse(text);
    const vector = data.embedding ? data.embedding.values : (data.embeddings ? data.embeddings[0].values : null);
    if (!vector) {
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Несподівана відповідь від Google' }) };
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vector }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Внутрішня помилка: ' + e.message }) };
  }
};
