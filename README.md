# FoodTracker for iPhone

The FoodTracker app, rebuilt to run entirely on the phone. It's a web app that
you add to the Home Screen, where it opens full screen like a normal app. Meals and
symptoms are saved **only on the phone**. Nothing is sent to any server except
barcode numbers, which go to the free Open Food Facts database when you look a
product up.

It shows patterns, not diagnoses. Bring the "Likely triggers" list to a doctor.

## One-time setup: put it online (free, about 10 minutes, on the PC)

The iPhone needs to load the app from a secure web address once. GitHub Pages
hosts it for free. Only the app's code is put online. Your log never is.

1. Go to https://github.com and create a free account (or sign in).
2. Click **+** (top right) > **New repository**. Name it `foodtracker`, choose
   **Public**, and click **Create repository**.
3. On the next page click **uploading an existing file**. Open the
   `FoodTracker-Phone` folder, select everything in it (including the `icons`
   folder), and drag it all onto the page. Click **Commit changes**.
4. Open the repository's **Settings** > **Pages**. Under "Branch" pick **main**
   and **/ (root)**, then click **Save**.
5. Wait a minute or two, then refresh that page. It shows the address, like
   `https://YOUR-USERNAME.github.io/foodtracker/`.

## Install it on the iPhone

1. On the iPhone, open that address in **Safari**. It has to be Safari.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. From now on, always open FoodTracker from the **Home Screen icon**. The
   Home Screen app keeps its own data, separate from the Safari tab.
4. While on Wi-Fi, try **Photo of label** and **Scan with camera** once. That
   saves the photo reader and scanner so they also work later without signal
   (looking up a barcode still needs internet).
5. If it asks for the camera, tap **Allow**.

## Backups (important)

The log lives only on the phone. If the app is removed from the Home Screen or
the phone is lost or reset, the log goes with it.

- **Backup tab > Save a backup > Save to Files > iCloud Drive.** Do this every
  week or so. The app reminds you when it's been more than 7 days.
- To restore on a new phone, or after reinstalling: **Backup tab > Choose backup file**.

## Moving entries from the PC version

1. In the PC version (`Coding\FoodTracker`), open **Timeline** and click
   **Backup for iPhone app**. A `.json` file downloads.
2. Get that file onto the iPhone, for example by emailing it to yourself or
   putting it in iCloud Drive.
3. In the iPhone app: **Backup tab > Choose backup file**, then pick it.

## Updating the app later

After changing any file:
1. In `sw.js`, raise the number in `VERSION` (for example `foodtracker-v2`).
2. Upload the changed files to the GitHub repository again (**Add file** > **Upload files**).

The phone picks up the new version the next time the app is opened with
internet. Updating never touches the saved log.

## Trying changes on the PC

Double-click **Preview on PC.bat** to open the app at http://localhost:8050.
Data entered there stays in that browser on the PC and isn't shared with the phone.

## Files

- `index.html`, `style.css`, `app.js`: the screens.
- `store.js`: saves data on the device (IndexedDB), plus backup and restore.
- `logic.js`: reads ingredient labels and works out likely triggers.
- `sw.js`, `manifest.webmanifest`, `icons/`: make it installable and usable offline.
