function extractContractInfo(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const codeElement = doc.querySelector('#editor');
  if (codeElement) {
    const codeText = codeElement.textContent;
    const pragmaIndex = codeText.indexOf('pragma solidity');
    if (pragmaIndex !== -1) {
      return codeText.substring(0, pragmaIndex).trim();
    }
  }
  return 'Could not extract contract info';
}

function formatInfo(info) {
  const lines = info.replace(/\/\*+|\*+\/|\/\/|\*/g, '').split('\n');
  return lines.map(line => {
    line = line.trim();
    if (line.includes(':')) {
      const [label, ...rest] = line.split(':');
      let url = rest.join(':').trim();

      if (label.toLowerCase() === 'https') {
        url = 'https://' + url;
      } else {
        if (url.startsWith('https:') && !url.startsWith('https://')) {
          url = url.replace('https:', 'https://');
        } else if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
      }

      url = url.replace(/^https:\/\/etherscan\.io\/address\//, '');

      return `<strong>${label}:</strong> <a href="${url}" target="_blank">${url.replace(/^https:\/\//, '')}</a>`;
    }
    return line;
  }).filter(line => line.length > 0).join('<br>');
}

function createInfoPanel(info) {
  const panel = document.createElement('div');
  panel.style.position = 'fixed';
  panel.style.left = '20px';
  panel.style.top = '50%';
  panel.style.transform = 'translateY(-50%)';
  panel.style.width = '400px';
  panel.style.padding = '15px';
  panel.style.backgroundColor = '#1c1e21';
  panel.style.border = '1px solid #2d2f31';
  panel.style.borderRadius = '5px';
  panel.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
  panel.style.zIndex = '1000';
  panel.style.maxHeight = '80vh';
  panel.style.overflowY = 'auto';
  panel.style.color = '#e4e6eb';
  panel.style.fontFamily = 'Monospace, monospace';

  const title = document.createElement('h3');
  title.textContent = 'Contract Info';
  title.style.marginBottom = '10px';
  title.style.color = '#e4e6eb';
  panel.appendChild(title);

  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = info;
  panel.appendChild(contentDiv);

  const closeButton = document.createElement('button');
  closeButton.innerHTML = '&times;';
  closeButton.style.position = 'absolute';
  closeButton.style.right = '10px';
  closeButton.style.top = '10px';
  closeButton.style.border = 'none';
  closeButton.style.background = 'none';
  closeButton.style.fontSize = '18px';
  closeButton.style.cursor = 'pointer';
  closeButton.style.color = '#e4e6eb';
  closeButton.onclick = function() {
    document.body.removeChild(panel);
  };
  panel.appendChild(closeButton);

  document.body.appendChild(panel);
}

function displayContractInfo() {
  // Check if relevant elements exist before creating the panel
  const bytecodeElements = [
    ...document.querySelectorAll('pre.wordwrap.scrollbar-custom'),
    ...document.querySelectorAll('.wordwrap.scrollbar-custom')
  ];
  const editorElement = document.querySelector('#editor');

  if (bytecodeElements.length === 0 && !editorElement) {
    console.log('No relevant elements found. Contract info panel will not be displayed.');
    return;
  }

  const currentUrl = window.location.href;
  const codeUrl = currentUrl + '#code';

  fetch(codeUrl)
    .then(response => response.text())
    .then(html => {
      const contractInfo = extractContractInfo(html);
      console.log('Extracted contract info:', contractInfo); // Add this line for debugging
      if (contractInfo !== 'Could not extract contract info') {
        const formattedInfo = formatInfo(contractInfo);
        createInfoPanel(formattedInfo);
      } else {
        console.log('Could not extract contract info. Panel will not be displayed.');
      }
    })
    .catch(error => console.error('Error fetching contract info:', error));
}

// Run the script when the page is loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  displayContractInfo();
} else {
  document.addEventListener('DOMContentLoaded', displayContractInfo);
}