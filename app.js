require('dotenv').config();  // Load environment variables from .env file
const puppeteer = require('puppeteer');
const { exec } = require('child_process');
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

// Import configuration (config.json contains Zoom meeting and other settings)
const config = require('./config');

// AWS S3 configuration using environment variables
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,  // Loaded from .env
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,  // Loaded from .env
  region: process.env.AWS_REGION,  // Loaded from .env
});

const BUCKET_NAME = config.AWS_S3.bucketName;  // Loaded from config.js (or .env)

const MEETING_ID = config.zoom.meetingId;
const MEETING_PASSWORD = config.zoom.meetingPassword;
const ZOOM_URL = config.zoom.meetingUrl;

// Set recording file name (with timestamp)
const RECORDING_PATH = `${config.recording.path}${MEETING_ID}-${Date.now()}.mp4`;

// Ensure recording directory exists
const recordingDirectory = path.dirname(RECORDING_PATH);
if (!fs.existsSync(recordingDirectory)) {
  fs.mkdirSync(recordingDirectory, { recursive: true });
}

// Function to start recording with FFmpeg (Video + Audio)
function startRecording() {
  console.log('Starting screen and audio recording...');
  
  // FFmpeg command to capture screen and audio
  const command = `ffmpeg -y -f x11grab -video_size 1366x768 -i :0.0 -f pulse -i default -c:v libx264 -preset ultrafast -crf 25 -c:a aac -strict -2 ${RECORDING_PATH}`;

  exec(command, (err, stdout, stderr) => {
    if (err) {
      console.error('Error starting screen and audio recording:', err);
      return;
    }
    console.log('Recording started successfully.');
  });
}

// Function to upload recording to AWS S3
function uploadToS3(filePath) {
  const fileContent = fs.readFileSync(filePath);
  const params = {
    Bucket: BUCKET_NAME,
    Key: path.basename(filePath), // Save with the same filename
    Body: fileContent,
  };

  s3.upload(params, (err, data) => {
    if (err) {
      console.error('Error uploading to S3:', err);
    } else {
      console.log('Upload successful:', data.Location);
    }
  });
}

// Automate Zoom Join with Puppeteer
async function joinZoomMeeting() {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,  // Run browser in non-headless mode for visibility
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    console.log('Navigating to Zoom meeting URL...');
    await page.goto(ZOOM_URL, { waitUntil: 'domcontentloaded' });

    // Wait for the meeting ID field and password field to appear
    console.log('Waiting for the Zoom fields to appear...');
    await page.waitForSelector('#join-confno', { timeout: 30000 });  // Wait for the meeting ID field
    await page.waitForSelector('#join-pwd', { timeout: 30000 });  // Wait for the password field

    // Take a screenshot for debugging purposes
    await page.screenshot({ path: 'zoom_debug.png' });
    console.log('Screenshot taken for debugging: zoom_debug.png');

    // Enter the meeting ID and password
    await page.type('#join-confno', MEETING_ID);
    await page.type('#join-pwd', MEETING_PASSWORD);

    // Click "Join" button
    await page.click('.btn-primary');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });  // Wait for meeting to start
    console.log('Successfully joined the meeting!');

    // Start screen and audio recording
    startRecording();

    // Wait for the meeting to end (or the configured duration)
    const meetingDuration = config.meetingDuration || 60; // Default to 60 minutes if not specified in config

    // Stop recording and upload after the meeting duration
    setTimeout(async () => {
      console.log('Ending recording...');
      // Stop FFmpeg recording (you can implement additional logic to stop recording based on meeting end)
      exec('pkill -f ffmpeg', (err, stdout, stderr) => {
        if (err) {
          console.error('Error stopping FFmpeg:', err);
        } else {
          console.log('FFmpeg process stopped.');
        }
      });

      // Upload recording to AWS S3
      await uploadToS3(RECORDING_PATH);  // Upload recording to AWS S3

      // Close the browser
      await browser.close();
      console.log('Browser closed, meeting recording uploaded to S3.');
    }, 60000 * meetingDuration); // Let the meeting run for the configured duration (in minutes)

  } catch (error) {
    console.error('Error during Zoom meeting automation:', error);
    if (browser) {
      await browser.close();
    }
  }
}

// Run the bot
joinZoomMeeting().catch(console.error);
