function extractContractInfo(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const codeElement = doc.querySelector('#editor');
  if (codeElement) {
    const codeText = codeElement.textContent;

    // Find the pragma solidity line
    const pragmaIndex = codeText.indexOf('pragma solidity');
    if (pragmaIndex !== -1) {
      // Get the line with pragma solidity
      const pragmaLineEnd = codeText.indexOf('\n', pragmaIndex);
      if (pragmaLineEnd !== -1) {
        // Look for the next multi-line comment block after pragma
        const afterPragma = codeText.substring(pragmaLineEnd + 1);
        const commentStart = afterPragma.indexOf('/*');
        if (commentStart !== -1) {
          const commentEnd = afterPragma.indexOf('*/', commentStart);
          if (commentEnd !== -1) {
            const commentBlock = afterPragma.substring(commentStart, commentEnd + 2);
            return commentBlock;
          }
        }
      }

      // Fallback: get everything before pragma (original behavior)
      return codeText.substring(0, pragmaIndex).trim();
    }
  }
  return 'Could not extract contract info';
}

function formatInfo(info) {
  // Remove comment markers but preserve the content structure
  const cleaned = info.replace(/\/\*+|\*+\/|^\s*\*\s?/gm, '').trim();
  const lines = cleaned.split('\n');

  return lines.map(line => {
    line = line.trim();
    if (!line) return '';

    // Skip unwanted standard lines
    if (line.includes('Submitted for verification at Etherscan.io') ||
        line.includes('SPDX-License-Identifier') ||
        line.startsWith('//') ||
        line.includes('Contract Info')) {
      return '';
    }

    // Check for URLs in various formats
    if (line.includes('http://') || line.includes('https://')) {
      // Extract URL from the line
      const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
      if (urlMatch) {
        const url = urlMatch[1];
        const beforeUrl = line.substring(0, line.indexOf(url)).trim();
        const afterUrl = line.substring(line.indexOf(url) + url.length).trim();

        let displayText = beforeUrl;
        if (beforeUrl.endsWith(':')) {
          displayText = beforeUrl.slice(0, -1);
        }

        return `<strong>${displayText}:</strong> <a href="${url}" target="_blank">${url}</a>${afterUrl ? ' ' + afterUrl : ''}`;
      }
    }

    // Handle label: value format (for non-URL content)
    if (line.includes(':') && !line.includes('http')) {
      const colonIndex = line.indexOf(':');
      const label = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();

      if (value) {
        return `<strong>${label}:</strong> ${value}`;
      } else {
        return `<strong>${label}</strong>`;
      }
    }

    // Regular text line
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
  panel.style.backgroundColor = 'rgba(28, 30, 33, 0.4)';
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