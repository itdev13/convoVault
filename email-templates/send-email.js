const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

/**
 * Send ConvoVault trial invitation email using Gmail
 * 
 * Setup:
 * 1. Enable 2-Factor Authentication in your Google Account
 * 2. Generate App Password: https://myaccount.google.com/apppasswords
 * 3. Use App Password in this script
 */

// Email configuration
const config = {
  from: {
    name: 'ConvoVault Team',
    email: 'rapiddev21@gmail.com'  // Replace with your Gmail
  },
  gmail: {
    user: 'rapiddev21@gmail.com',  // Replace with your Gmail
    pass: 'password' // Replace with Gmail App Password
  }
};

// Create transporter (note: createTransport, not createTransporter)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.gmail.user,
    pass: config.gmail.pass
  }
});

// Read HTML template
const htmlTemplate = fs.readFileSync(
  path.join(__dirname, 'trial-invitation.html'),
  'utf8'
);

// Send email function
async function sendTrialEmail(recipientEmail, recipientName = '') {
  try {
    // Personalize template if name provided
    let personalizedHtml = htmlTemplate;
    if (recipientName) {
      personalizedHtml = htmlTemplate.replace(
        'Hi there! 👋',
        `Hi ${recipientName}! 👋`
      );
    }

    const info = await transporter.sendMail({
      from: `"${config.from.name}" <${config.from.email}>`,
      to: recipientEmail,
      subject: 'Start Your Free 7-Day Trial of ConvoVault 🚀',
      html: personalizedHtml,
      
    });

    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    return true;

  } catch (error) {
    console.error('❌ Failed to send email:', error);
    return false;
  }
}

// Send to multiple recipients
async function sendBulk() {
  const recipients = [
    { email: 'n151272@rguktn.ac.in', name: 'Bindu' },
  ];

  for (const recipient of recipients) {
    console.log(`Sending to ${recipient.email}...`);
    await sendTrialEmail(recipient.email, recipient.name);
    
    // Wait 2 seconds between emails to avoid Gmail rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('✅ All emails sent!');
}

// Run the script
sendBulk();     // Send to recipients

module.exports = { sendTrialEmail };

