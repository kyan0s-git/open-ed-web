# Using open-ed-web

## 1. Get a course

1. Find a course on [MIT OpenCourseWare](https://ocw.mit.edu), for example
   [8.04 Quantum Physics I](https://ocw.mit.edu/courses/8-04-quantum-physics-i-spring-2016/).
2. On the course page, choose **Download course** (in the course menu) and save the `.zip`.
   Some courses are a few hundred megabytes.

Courses published in OCW's current format, which is nearly all of them since 2022, are
supported. If you have an old pre-2022 package, the app says so and asks you to download
a fresh copy.

## 2. Import it

Open **Import** in the top bar and drop the `.zip` on the page, or choose it with the
file picker. Importing takes a few seconds. The app keeps its own copy of the archive,
in the browser's storage or the desktop app's data folder, and reads pages, PDFs and
images straight from it. **You can delete the downloaded `.zip` afterwards**; the course
stays. Nothing is uploaded anywhere unless you turn on course storage (section 7).

Importing the same course again (for example a newer download) updates it in place and
keeps your progress.

## 3. Study

- **The course page** shows what the course covers, how far along you are, and a
  **Start**/**Continue** button.
- **The reader** follows the course's own sidebar. Use **Previous**/**Next** at the bottom,
  or `p` and `n` on the keyboard, to move through materials in study order: a lecture's
  notes, then its video, then its problem set.
- **PDFs** open in the built-in viewer. Zoom, fit to width, and dim the page for night
  reading. The viewer remembers where you were.
- **Videos** play from YouTube. The transcript from the archive is one click away.
- **Mark finished** when you are done with a page.

## 4. Rate, and review

After each material, rate how well you know it: **Not yet**, **Shaky**, **Solid** or
**Easy**. Where OCW includes quiz questions, you answer those instead. The app schedules
the next review with FSRS, a spaced-repetition algorithm. Things you find hard come back
sooner, and things you know come back later.

**Review** in the top bar collects everything due across all your courses. Each skill
has a level, from *attempted* through *familiar* and *proficient* to *mastered*, based
on how long you are likely to remember it.

The **dashboard** shows what is due, your daily streak, overall mastery, and your last
two weeks of activity.

## 5. Search

Press `/` anywhere, or use **Search** in the top bar. Search covers page text, material
titles, and the full text of every PDF and video transcript, in all your courses or just
one. A hit inside a PDF opens it at the right page with the words highlighted.

PDF text is read in the background after an import, so those results fill in over the
first minute or so.

## 6. Your progress file

Everything you do is recorded in one `progress.json`. **Settings → Your progress** lets
you:

- **Export** it, to back it up or move it by hand;
- **Import and merge** a file from elsewhere. Nothing is overwritten: where both copies
  have a record, the newer one wins;
- **Keep it in a file I choose** (Chrome and Edge), so every change is also saved to a
  file you can see, for example in a synced folder.

## 7. Sync between devices

Sync needs a sync server: the site you are using, if it was set up with sync (see
[self-hosting.md](self-hosting.md)), or one you run yourself.

**On your first device:** open **Settings → Sync across devices** and choose **Turn on
sync**.

**On each other device:** on the first device, choose **Add another device**. Then either:

- scan the QR code with your phone's camera, or open the link on the other device, and
  choose **Connect**; or
- in the desktop app, paste the link under **I have a sync link**.

Each device keeps its own progress and merges with the others, so you can connect a
device that already has history. From then on, devices sync on their own: when they
start, shortly after you finish something, and every few minutes while open. They also
work offline and catch up later. **Sync now** forces a sync.

The link is the only key to your synced progress, so share it only with your own
devices. To stop, use **Stop syncing**: either just on this device, or delete the synced
copy from the server for all devices. Progress on each device always stays. More detail
is in [sync.md](sync.md).

Course files are not synced unless you choose to store them on the server (below).
Without that, import each course on each device where you want to read it. Progress for
a course you have not imported yet waits until you do.

### Storing courses on the server

If your sync server has course storage turned on, **Settings → Sync across devices →
Courses on the server** offers:

- **Store courses on the sync server**: the switch for this device. It is off until you
  turn it on.
- **Upload courses I import on this device**: on by default once storage is on. Turn it
  off to upload only the courses you pick, with **Upload to server** in the list of
  stored courses.
- **Download courses my other devices store**: off by default. Turn it on to have
  courses appear on this device by themselves, up to a size you choose (100 MB to any
  size). Larger ones wait for you.

Courses your other devices stored, but this one does not have yet, appear under
**Courses → On your sync server** with a **Download** button. Uploads go in 4 MB pieces
and resume if interrupted; a course already on the server is not uploaded again. Courses
are encrypted on your device like your progress. **Remove from server** deletes the
server's copy for every device but keeps the copies already on devices.

## 8. Install it

- **As a desktop app:** download an installer from the Releases page. See
  [desktop.md](desktop.md).
- **Storage:** the app asks the browser to keep its data persistently. Some browsers can
  still clear site data for sites you have not visited in a while: Safari does this after
  7 days without a visit. Use sync, or export your progress now and then, if you rely on
  such a browser.

## Troubleshooting

- **"Progress is not saving"** in Settings means the browser refused to write, usually
  because the device is out of space or in a private window. Export your progress, free up
  space, then import it again.
- **Sync says "Could not reach the sync server"**: the device is offline or the server is
  down. Your progress is safe on the device and syncs when the server is back.
- **Sync says "The server refused this sync link"**: the vault was deleted from another
  device. Turn sync off on this device and connect it again with a new link.
- **A course will not import**: check that it is a full **Download course** archive from
  ocw.mit.edu. Individual files or partial downloads are not courses.
