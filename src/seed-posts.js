'use strict';
// The four launch articles. Bodies are Markdown; ```prompt blocks render as "You type" boxes,
// blockquotes render as callouts, and raw HTML is allowed (admin-authored content only).
module.exports = [
{
  slug: 'one-sentence-reel', category: 'Guides', mins: 5, featured: true, date: '2026-10-11',
  title: 'How to turn a raw clip into a captioned Reel with one sentence',
  dek: 'A walkthrough of a real SnapQut session: one talking-head clip, one sentence typed into Claude, and a finished 9:16 Reel about three minutes later.',
  cover: ['/media/after.jpg', '/media/before.jpg', '/media/stills/still-5.jpg'],
  body: `## What you need

- **Claude**, ideally Claude Code. SnapQut works best there and gives the most consistent results.
- **SnapQut**, installed in a folder on your computer.
- **One raw clip.** Straight off your phone or camera is fine. No trimming needed.

## Step 1: Open your SnapQut folder

Start a new chat in Claude and pick the folder where SnapQut is installed. That tells Claude where your editing kit lives: the styles, fonts and render engine it will use for the edit.

## Step 2: Attach the raw video

Click **+** and attach your clip. There's nothing to import and no project to set up. The file shows up in the message box, ready to go.

## Step 3: Type one sentence

Describe what you want the way you'd brief a human editor. In the demo, this was the whole brief:

\`\`\`prompt
Make this video with caption and choose the best template above you think is the best
\`\`\`

You don't need to name a template, a font or a caption style. If you leave a choice open, Claude makes it for you based on the footage.

## Step 4: Let it edit

Here's what SnapQut did with that one sentence, in about three minutes:

- **Picked a style on its own.** The clip is one person talking straight to camera, so it chose the Talking Head Reel style: big one-word pop-up captions, a zoom that alternates on cuts and a progress line.
- **Fixed the transcript.** It re-listened to two moments where the speech model dropped a word and corrected them before captioning.
- **Cut the dead air.** About 1.4 seconds of pauses came out. Nothing the speaker said was removed.
- **Styled the captions.** Key words were highlighted in yellow, with a few emoji on matching words.
- **Checked its own work.** It looked at preview frames, noticed the hook title covered the speaker's eyes, and took it out.

<dl class="facts">
<div><dt>Length</dt><dd>61.5 seconds</dd></div>
<div><dt>Format</dt><dd>Vertical 9:16</dd></div>
<div><dt>Time to render</dt><dd>About 3 minutes</dd></div>
</dl>

## Change anything with a follow-up

Don't like a choice? Say so in the same chat. A few follow-ups that work well:

\`\`\`prompt
Try a bolder caption look with two words at a time
\`\`\`

\`\`\`prompt
Make it 30 seconds and keep the strongest lines
\`\`\`

\`\`\`prompt
Add B-roll over the part about camera fear
\`\`\`

## Tips for better first drafts

- **Clean audio helps.** Captions are built from the transcript, so a clear voice track means fewer fixes.
- **Name the platform** if it matters: Reels, Shorts, TikTok or YouTube.
- **Say what to avoid,** like "no emoji" or "keep the captions off his face".
`
},
{
  slug: 'learn-a-creators-style', category: 'Style', mins: 4, date: '2026-10-11',
  title: "Teach SnapQut a creator's style with 3 to 6 reference videos",
  dek: 'Show it a few videos you like and it studies the cuts, pacing, captions and B-roll, then edits your footage the same way.',
  cover: ['/media/stills/still-6.jpg', '/media/stills/still-3.jpg', '/media/stills/still-7.jpg'],
  body: `## What it learns from your references

When you give SnapQut reference videos, it studies how they're edited, not what they say. It looks at four things:

- **Cuts:** how often the shot changes and where the cuts land.
- **Pacing:** how fast the video moves and how much silence is left in.
- **Captions:** size, position, how many words show at once and which words get highlighted.
- **B-roll:** when cutaway shots appear and how long they stay.

## How to choose good references

- **Use 3 to 6 videos.** One video can be a fluke. A few show the pattern.
- **Keep them consistent.** Pick videos from the same creator and the same format, for example all talking-head Reels.
- **Match your footage.** A podcast-style reference suits podcast-style footage better than a fast product montage does.
- **Pick what you'd actually post.** The closer the references are to your goal, the closer the first draft will be.

## How to ask for it

Attach the reference videos and your raw footage, then describe the job:

\`\`\`prompt
Watch these 4 videos and learn their editing style. Then edit my raw footage to match.
\`\`\`

If one detail matters more than the rest, say it:

\`\`\`prompt
Match their caption style exactly, but keep my pacing a little slower
\`\`\`

## No references? Describe the style instead

You can also build a custom style from a description. Be specific about what you see and hear:

\`\`\`prompt
Cuts every 2 to 3 seconds, white captions with yellow keywords, no emoji, slow zoom on the punchlines
\`\`\`

> **Good practice:** use references to learn a style, not to copy someone's content. Your footage, your words, their editing rhythm.
`
},
{
  slug: 'ad-structures-pas-aida-bab', category: 'Ads', mins: 6, date: '2026-10-11',
  title: 'PAS, AIDA or Before-After-Bridge: which ad structure fits your video?',
  dek: 'SnapQut can edit your footage into proven ad structures. Here is what each one does, when to use it, and the one-line brief that gets you there.',
  cover: ['/media/stills/still-1.jpg', '/media/stills/still-4.jpg', '/media/stills/still-2.jpg'],
  body: `## Why structure matters in a short ad

A short ad has seconds to earn attention and a few more to make its point. A proven structure gives every second a job, so the viewer always knows why they're still watching.

## PAS: Problem, Agitate, Solution

Name a problem your viewer has, make it feel real, then show your product as the fix.

**Best for** products that solve a pain people already feel.

\`\`\`prompt
Turn this into a 30-second PAS ad for our accounting app. End with "Book a free demo".
\`\`\`

## AIDA: Attention, Interest, Desire, Action

Open with a hook, build interest with what's new, create desire with the payoff, then ask for one clear action.

**Best for** launches and offers where the product itself is the news.

\`\`\`prompt
Edit this into an AIDA ad. Strong hook in the first 2 seconds, and end on the offer.
\`\`\`

## Before-After-Bridge

Show life before, show life after, then reveal what gets you from one to the other.

**Best for** visible transformations: results, makeovers and time saved.

\`\`\`prompt
Make a Before-After-Bridge ad from these clips. Before is the messy desk, after is the finished video.
\`\`\`

## UGC-style ads

Creator-style ads look like a real person sharing an honest take rather than a polished commercial. SnapQut can edit your footage in that style too.

\`\`\`prompt
Edit this as a UGC-style ad. Keep it casual, captions on, and end with the link in bio.
\`\`\`

## Which one should you pick?

| Structure | Opens with | Use it when |
|---|---|---|
| **PAS** | The problem | Your viewer already feels the pain |
| **AIDA** | A hook | You have news, a launch or an offer |
| **Before-After-Bridge** | The "before" state | The result is easy to show on camera |
| **UGC-style** | A person talking | You want it to feel like a recommendation |

Not sure? Ask for two versions and compare them:

\`\`\`prompt
Make a PAS version and an AIDA version of this ad so I can test both
\`\`\`
`
},
{
  slug: 'word-locked-captions', category: 'Captions', mins: 4, date: '2026-10-11',
  title: 'Word-locked captions: what they are and how to ask for them',
  dek: 'Captions that appear exactly as each word is spoken keep viewers reading along. Here is how SnapQut builds them and how to get the look you want.',
  cover: ['/media/stills/still-5.jpg', '/media/stills/still-9.jpg', '/media/stills/still-10.jpg'],
  body: `## What "word-locked" means

Word-locked captions are timed to each spoken word. A word appears on screen at the moment it's said, instead of a whole sentence sitting there for a few seconds. The result feels in sync with the voice, and viewers who watch with the sound off can still follow along.

## How SnapQut builds them

- **Word-level timings.** It transcribes your clip and records when each word starts and ends.
- **Fixes before styling.** If the speech model drops or mishears a word, SnapQut re-listens to that moment and corrects it. In our demo it fixed two of these before captioning.
- **Placement checks.** It looks at preview frames so captions and titles don't cover the speaker's face.

## Common caption looks

- **One-word pop-ups:** big, centred, one word at a time. High energy and great for talking heads.
- **Two to three words:** easier to read on longer sentences.
- **Keyword highlights:** important words in a second colour, like yellow.
- **Emoji accents:** a small emoji on matching words, used sparingly.

## How to ask for the look you want

\`\`\`prompt
Captions one word at a time, keywords in yellow
\`\`\`

\`\`\`prompt
Two-line captions near the bottom, no emoji
\`\`\`

\`\`\`prompt
Keep the captions above the mic so they never cover his face
\`\`\`

## A quick caption checklist

1. Every word matches what was said.
2. Captions never cover the face or the product.
3. Highlighted words are the ones that matter.
4. Text is readable on a phone at arm's length.
`
}
];
