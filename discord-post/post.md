🧑‍💼 **Apna Babu: the government clerk who works for you**
*Every Indian has paid a tout to fill a form. Apna Babu does it free, in your language.*

**Team:** Saksham Singh Sisodiya, Parth Dande
**College:** MIT-WPU
**Live:** https://apna-babu.vercel.app
**GitHub:** https://github.com/SakshamSinghSisodiya/apna-babu

**The problem**
Bank forms, scholarship applications and court notices are mostly in English or officialese. People can answer every question on the form, they just can't read it, so they pay a tout or give up on what they're entitled to.

**How it works**
📄 Upload a photo or PDF of any form or official letter, or try a sample
🗣️ Pick English, हिंदी, मराठी or Hinglish
🎙️ Babu asks one question at a time, out loud. Answer by voice or text
✅ Every answer is validated and read back, while the English form fills in live
🖨️ Get a print-ready form, plus a spoken summary of what's missing and what to carry

Got a bill, notice or summons instead? Babu explains it and drafts the right reply: a complaint, reply letter or RTI application.

**Sarvam APIs used**
• **Sarvam Vision (Document Intelligence):** reads the uploaded page
• **sarvam-105b-conversations:** builds the field schema, extracts answers, writes summaries and letters
• **Mayura:** translates every question and label, with code-mixed mode for Hinglish
• **Bulbul v4-flash:** speaks every line in one voice across all four languages
• **Saaras v4:** transcribes answers, including code-mixed speech
• **Language Identification:** notices if you switch languages and offers to follow
• **Transliterate:** moves names and addresses between Devanagari and Latin

Nothing is stored on our servers. Screenshots use made-up demo data. 👇
