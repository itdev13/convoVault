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
    pass: 'byhp nojb ybxu rgwy' // Replace with Gmail App Password
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
async function sendTrialEmail(recipientEmail) {
  try {
    // Personalize template if name provided
    let personalizedHtml = htmlTemplate;

    const info = await transporter.sendMail({
      from: `"${config.from.name}" <${config.from.email}>`,
      to: recipientEmail,
      subject: 'Start Your Free 7-Day Trial - Export Conversations and Messages 🚀',
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
//   const recipients = [
//     'jennannedesigns80@gmail.com', 
//     "amartinsmail2@gmail.com",
//     "ajmmartinsdacosta@gmail.com",
//     "joaocmartins11@gmail.com",
//     "mendesol@live.com",
//     "mendes@crmnotoria.com",
//     "basecrm@notoria.pro",
//     "sekoufiscal@gmail.com",
//     "jkadingo89@gmail.com",
//     "ahmad@clientfiller.com",
//     "juve96815@gmail.com",
//   ];

//   const recipients = [
//     "abtorpie@gmail.com",
//     "nikkidesantis94@gmail.com",
//     "nikki@resmarksystems.com",
//     "aigentpros@gmail.com",
//     "admin@lemayconsulting.com",
//     "mark@hang10digital.com",
//     "eric@progressivedental.com",
//     "leoyoke137@gmail.com",
//     "info@zenica.ai",
//     "mydiscord.alt10@gmail.com",
//     "tristanstier022@gmail.com",
//     "stier.tristan@gmail.com"
//   ]

//  const recipients = [
//     "rami.abugawad@gmail.com",
//     "aigrowthpartners@gmail.com",
//     "samuel@clipsity.com",
//     "tracey@iultelesalesmastery.com",
//     "tlipnicki.sfg@gmail.com",
//     "tracey@thelipnickiagency.com",
//     "melissa@yourbusinessmedia.com",
//     "orlandocastillo.vestaagencia@gmail.com",
//     "ccpofficialagency@gmail.com",
//     "virtualmarketing.sj@gmail.com",
//     "paulinedanicachuavillante@gmail.com",
//     "malaveroll@gmail.com",
//     "paulinedanicachuavillante@gmail.com"
//  ]

// const recipients = [
//     "edwin.mo.jr@gmail.com",
//     "clutchedcanada@gmail.com",
//     "aielloalex5@gmail.com",
//     "jafootball@gmail.com",
//     "marketing@encountertravel.com.au",
//     "brandgrowthsolutionscr@gmail.com",
//     "info@allmadewell.com",
//     "eric@uplevelpro.com",
//     "angley@skylerdesignbuild.com",
//     "carlosperezcruz16@duck.com",
//     "charliehiggins65@yahoo.com",
//     "charles@getpinnacle.ai",
//     "client11.theleadleader@gmail.com",
//     "keith.besherse@gmail.com",
//     "matt@profeds.com",
//     "info@1customerplus.com",
// ]

// const recipients = [
//   "support@boostpatients.com"
// ]
// const recipients =[
//   "valerie@asn.approvedseniornetwork.com",
//   "info@neuruclients.com",
//   "johnbassettibusiness+computer@gmail.com",
//   "david@digitalagencyhacker.com",
//   "roxanne@foxycreative.marketing",
//   "gloria.maynard.morales@gmail.com",
//   "kalongoodrich@gmail.com",
//   "georgina@digitalagencyhacker.com",
//   "joyp@newroadadvertising.com",
//   "don.puerto.1003@gmail.com",
//   "yiannisandreou@yahoo.gr",
//   "artofwore@gmail.com",
//   "matt+trial@4edgemarketing.com",
//   "danny.rios@agencyremix.com",
//   "robert@thefourtwothree.com",
//   "inayet@hadicloud.com",
//   "ostertag.co@gmail.com",
//   "jsolano@xltrecruiting.com",
//   "sonnie.donaby@sonfudigital.com",
//   "s.utmurphy@tykeyhomes.com",
//   "nora.lunasco@level9virtual.com",
//   "jean@studentconvert.com.au",
//   "noah@zmarkenterprises.com"
// ]

const recipients = [
"steve@jsumedia.com",
"bjsticker7396@gmail.com",
"joe@apexcrm.tech",
"joshua.john.wagner@gmail.com",
"annabelen@abapartnersplus.com",
]
  for (const recipient of recipients) {
    console.log(`Sending to ${recipient}...`);
    await sendTrialEmail(recipient);
    
    // Wait 2 seconds between emails to avoid Gmail rate limits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('✅ All emails sent!');
}

// Run the script
sendBulk();     // Send to recipients

module.exports = { sendTrialEmail };

