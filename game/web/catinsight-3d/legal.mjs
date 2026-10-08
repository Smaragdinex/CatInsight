// Privacy / Support 的內容(和 /privacy、/support 網頁同一份文字):在地球那頁用一塊直的長面板顯示,不用換頁
const MAIL = '<a class="mail" href="mailto:contact@xarts.games">contact@xarts.games</a>';

export const DOCS = {
  privacy: {
    color: '#7b9cff',
    html: `
    <div class="eyebrow">LEGAL</div>
    <h1>Privacy Policy</h1>
    <div class="upd">Last updated: June 2026</div>
    <p>X-Arts Corporation LTD ("we", "us") built the CatInsight Stock app as a free application for stock research and analytics. This service is provided at no cost and is intended for use as is. This page explains what information the app handles and how.</p>
    <h2>No Account Required</h2>
    <p>CatInsight Stock does not require you to create an account or sign in. We do not ask for or collect your name, email address, phone number, or any other directly identifying personal information.</p>
    <h2>Information Stored on Your Device</h2>
    <p>Your watchlist, price/indicator alerts, saved AI conversations, and app settings are stored locally on your device. This information stays on your device and is not uploaded to us unless required to provide a feature, as described below.</p>
    <h2>Information Sent to Our Servers</h2>
    <p>To provide its features, the app sends certain inputs to our backend service:</p>
    <ul>
      <li><b>Stock symbols you search for or view</b>, and the symbols in your watchlist, are sent to our servers to retrieve quotes, charts, fundamentals, ratings, news, and rankings.</li>
      <li><b>Questions and messages you type into the AI assistant</b> are sent to our servers to generate a response. These may be processed by an AI language model and may include the stock context shown in the app.</li>
    </ul>
    <p>We use this information only to return the requested results. We do not use it to build advertising profiles, and we do not sell it.</p>
    <h2>Third-Party Services</h2>
    <p>The app relies on third-party providers to function, and relevant data may be processed by them:</p>
    <ul>
      <li><b>Market data providers</b> supply quotes, fundamentals, analyst data, and news.</li>
      <li><b>AI language model providers</b> may process the questions you send to the AI assistant in order to generate responses.</li>
    </ul>
    <p>These providers process data according to their own privacy policies.</p>
    <h2>Log Data</h2>
    <p>In case of an error, Apple may collect data and information (through third-party products) on your device called Log Data. This may include your device IP address, device name, operating system version, app configuration, and the time and date of use. We do not personally access or store this data.</p>
    <h2>Cookies</h2>
    <p>This app does not use cookies.</p>
    <h2>Children's Privacy</h2>
    <p>This app is not directed to children and does not knowingly collect personal information from children.</p>
    <h2>Data Retention</h2>
    <p>Data stored on your device remains until you delete it or uninstall the app. Requests sent to our servers are processed to return results and are not used to identify you.</p>
    <h2>Not Investment Advice</h2>
    <p>CatInsight Stock is provided for informational and educational purposes only. It does not provide personalized investment advice, and nothing in the app should be treated as a recommendation to buy or sell any security.</p>
    <h2>Changes to This Privacy Policy</h2>
    <p>We may update this Privacy Policy from time to time. You are advised to review this page periodically for any changes.</p>
    <h2>Contact Us</h2>
    <p>If you have any questions or suggestions about this Privacy Policy, contact us at ${MAIL}.</p>`,
  },
  support: {
    color: '#4be07a',
    html: `
    <div class="dhero"><img src="/assets/icon-180.png" alt=""><div class="eyebrow">SUPPORT</div><h1>How can we help?</h1>
      <p>Questions, feedback or bug reports — we're happy to assist.</p></div>
    <div class="dcard">
      <h2>Contact</h2>
      <p>We aim to respond within a few business days.</p>
      <p class="dmail">✉ ${MAIL}</p>
    </div>
    <div class="dcard">
      <h2>About the App</h2>
      <p>CatInsight Stock is an informational stock research and analytics tool for US and Taiwan markets. It offers a machine-learning stock ranking, technical and fundamental data, charts, news, watchlists, alerts, and an AI research assistant for natural-language questions about stocks.</p>
    </div>
    <div class="dcard">
      <h2>Frequently Asked Questions</h2>
      <p class="q">Do I need an account?</p>
      <p>No. The app works immediately with no sign-up or login.</p>
      <p class="q">Is this investment advice?</p>
      <p>No. CatInsight Stock is for informational and educational purposes only. It does not provide personalized investment advice or execute trades. All valuations shown are model reference figures, not recommendations.</p>
      <p class="q">Where does the data come from?</p>
      <p>Market data, fundamentals, analyst figures and news are sourced from third-party financial data providers and may be delayed.</p>
      <p class="q">How is my data handled?</p>
      <p>Please see our <a class="link" href="/privacy" data-doc="privacy">Privacy Policy</a>.</p>
    </div>`,
  },
};
