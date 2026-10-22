# Scriptline

Paste a public Instagram reel or post. Get the creator, the counts, the words that were spoken, and a practice you can actually do.

Scriptline is a small web app for people who save reels and then never look at them again. It keeps a log on your device, and it turns a transcript into a claim, a few concepts, and something to try on your own work.

## What you can do

- Extract one link, or up to 12 at a time
- Read metadata without an Instagram login: creator, caption, views, likes, comments, music
- Transcribe the spoken audio, with timed lines
- Export a single reel as Markdown, plain text, SRT, or JSON
- Pull a stand-in for the post: the caption, the spoken words, one frame, what you can learn, and a small practice
- Search the log and download the whole notebook

The public page includes the replies Instagram renders without an account. Replies hidden behind a login are not included, and Scriptline does not ask for a password.

## What is tested

- The embed parser, against a fixture of Instagram's public embed page
- The lesson check that rejects anything cited from comments
- A production build and a smoke load of the page

Live reels still depend on Instagram and on the speech API. A private or deleted post fails on purpose.

Public posts only. Private, deleted, and login-walled links will not open.

## Run it

```bash
npm install
npm run dev
```

Open the app and paste a reel URL.

Speech-to-text and the practice pass call the [xAI API](https://docs.x.ai). Set `XAI_API_KEY` in the environment before you start the app. Metadata still works without it.

```bash
XAI_API_KEY=your_key npm run dev
```

## Limits

- Reels longer than 10 minutes are saved with metadata and caption only
- A burst of extractions is rate-limited so one session cannot drain the API key
- The log lives in this browser. Download the notebook if you want a copy you can move

## Not affiliated

Scriptline is not Instagram and is not Meta. It reads public embed data and the public video file. Do not use it on accounts or posts you are not allowed to access.
