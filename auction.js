// Enhanced auction.js with accumulated bid logic
document.addEventListener('DOMContentLoaded', async () => {
    const contractABI = [
      {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"bidder","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"},{"indexed":false,"internalType":"uint256","name":"total","type":"uint256"}],"name":"BidPlaced","type":"event"},
      {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"bidder","type":"address"},{"indexed":false,"internalType":"uint256","name":"total","type":"uint256"}],"name":"NewHighBid","type":"event"},
      {"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"bidder","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Withdrawn","type":"event"},
      {"inputs":[],"name":"auctionEndTime","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[],"name":"highestBid","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[],"name":"highestBidder","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
      {"inputs":[{"internalType":"address","name":"","type":"address"}],"name":"bids","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[{"internalType":"uint256","name":"","type":"uint256"}],"name":"bidders","outputs":[{"internalType":"address","name":"","type":"address"}],"stateMutability":"view","type":"function"},
      {"inputs":[],"name":"biddersCount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
      {"inputs":[],"name":"bid","outputs":[],"stateMutability":"payable","type":"function"},
      {"inputs":[],"name":"withdraw","outputs":[],"stateMutability":"nonpayable","type":"function"}
    ];
    const backendUrl = location.origin;

    // DOM refs
    const participantInfoEl = document.getElementById('participantInfo');
    const bidActionBox = document.getElementById('bidActionBox');
    const bidList = document.getElementById('bidList');
    const timerEl = document.getElementById('timer');
    const auctionTitleEl = document.getElementById('auctionTitle');
    const auctionStatusEl = document.getElementById('auctionStatus');
    const bidCountEl = document.getElementById('bidCount');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');

    let provider = null, signer = null, contract = null, socket = null;
    let localTimerInterval = null, timeLeftSeconds = null;
    let currentWallet = null;
    let minBid = 0.0001, highestBid = 0, contractAddress = null;
    let currentUserBid = 0; // Track current user's accumulated bid
    let hasAnyBidder = false; // Track if there are any bidders
    const user = parseUrlParams();

    // Fetch auction details
    try {
        const response = await fetch(`${backendUrl}/api/auction-details?id=${user.id || '101'}`);
        const data = await response.json();
        if (data.ok) {
            contractAddress = data.contractAddress;
            minBid = data.minBid;
            highestBid = data.highestBid;
            hasAnyBidder = data.highestBid > 0;
            timeLeftSeconds = Math.max(0, data.auctionEndTime - Math.floor(Date.now() / 1000));
            if (data.ended) {
                renderTime(0, true);
                if (auctionStatusEl) {
                    auctionStatusEl.textContent = '🔴 Live Ended';
                    auctionStatusEl.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                    auctionStatusEl.style.color = 'white';
                }
                showToast('Auction has ended', 'warning');
            }
        } else {
            console.error('Failed to fetch auction details:', data.error);
            showToast('Failed to load auction. Please try again.', 'error');
            return;
        }
    } catch (e) {
        console.error('Error fetching auction details:', e);
        showToast('Server connection failed.', 'error');
        return;
    }

    // Initialize
    if (user.name && participantInfoEl) {
        participantInfoEl.textContent = `${user.name} (${(user.mode||'watch').toUpperCase()})`;
    }
    if (auctionTitleEl) {
        auctionTitleEl.textContent = `🏆 Bid: Item #${user.id || '—'}`;
    }
    // Set item title and description based on auction ID
    if (user.id === '101') {
        document.getElementById('itemTitle').textContent = 'The Painting of Etherwave';
        document.getElementById('itemDescription').textContent = 'An exclusive item with high historical value. A rare opportunity to own a unique digital artwork verified on the blockchain.';
        document.querySelector('.item-image').src = 'Images/Etherwave.png';
    } else if (user.id === '102') {
        document.getElementById('itemTitle').textContent = 'The Statue of Satoshi Nakamoto';
        document.getElementById('itemDescription').textContent = 'Exclusive Satoshi Nakamoto statue, verified on the blockchain.';
        document.querySelector('.item-image').src = 'Images/Satoshi.png';
    }

    initSocket();

    // Utility Functions
    function parseUrlParams() {
        try {
            const p = new URLSearchParams(window.location.search);
            return {
                id: p.get('id'),
                name: p.get('name'),
                mode: p.get('mode')
            };
        } catch {
            return {};
        }
    }

    function showLoading(message = 'Processing...') {
        if (loadingOverlay && loadingText) {
            loadingText.textContent = message;
            loadingOverlay.style.display = 'flex';
        }
    }

    function hideLoading() {
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    }

    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="font-size: 1.5em;">
                    ${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <span style="flex: 1;">${message}</span>
            </div>
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'slideInUp 0.3s ease-out reverse';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // Render Panels
    function renderConnectPanel() {
        const tpl = document.getElementById('connect-wallet-panel-template');
        bidActionBox.innerHTML = '';
        if (tpl) bidActionBox.appendChild(tpl.content.cloneNode(true));
        const btn = document.getElementById('connectWalletBtn');
        if (btn) btn.addEventListener('click', onConnect);
    }

    function renderBidderPanel() {
        const tpl = document.getElementById('bidder-panel-template');
        bidActionBox.innerHTML = '';
        if (tpl) bidActionBox.appendChild(tpl.content.cloneNode(true));
        bindActions();
        updateBidInfo();
    }

    function updateBidInfo() {
        const statusEl = document.getElementById('status');
        if (!statusEl) return;

        if (currentUserBid > 0) {
            statusEl.innerHTML = `
                <div style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%); 
                            padding: 1rem; 
                            border-radius: var(--radius-lg); 
                            border-left: 4px solid var(--success);">
                    <small style="color: var(--gray-600); margin-top: 0.5rem; display: block;">
                        ${currentUserBid >= highestBid 
                            ? '🎉 You are currently the leading bidder!' 
                            : `⚡ Place a higher bid to take the lead `}
                    </small>
                </div>
            `;
        } else {
            statusEl.innerHTML = `
                <div style="color: var(--gray-600);">
                    ${hasAnyBidder 
                        `The highest bid right now is ${formatEth(highestBid)} ETH` }
                </div>
            `;
        }
    }

    function bindActions() {
        const bidBtn = document.getElementById('bidButton');
        const withdrawBtn = document.getElementById('withdrawButton');
        const bidInput = document.getElementById('bidAmount');
        const status = document.getElementById('status');

        if (bidBtn) bidBtn.addEventListener('click', () => placeBid(bidInput, status));
        if (withdrawBtn) withdrawBtn.addEventListener('click', () => withdraw(status));

        // Real-time input validation
        if (bidInput) {
            bidInput.placeholder = ' ';
            bidInput.addEventListener('input', () => {
                const val = parseFloat(bidInput.value);
                const newTotal = currentUserBid + val;
                
                if (val > 0 && newTotal > highestBid) {
                    bidInput.style.borderColor = 'var(--success)';
                    if (status) {
                        status.innerHTML = ``;
                    }
                } else {
                    bidInput.style.borderColor = 'var(--danger)';
                    if (status) {
                        const requiredMin = hasAnyBidder ? highestBid + 0.0001 : minBid;
                        const needMore = requiredMin - currentUserBid;
                        status.innerHTML = `
                            <div style="color: var(--danger);">
                                ${val > 0 
                                    `The highest bid right now is (${formatEth(highestBid)} ETH)`}
                            </div>
                        `;
                    }
                }
            });
        }
    }

    async function onConnect() {
        const ok = await connectWallet();
        if (!ok) return;
        renderBidderPanel();
        const addr = await signer.getAddress();
        currentWallet = addr.toLowerCase();
        attachWalletToSocket(addr);

        // Fetch current user's bid from contract
        await updateCurrentUserBid();

        const walletInfo = document.getElementById('walletInfo');
        const connectedWallet = document.getElementById('connectedWallet');
        if (walletInfo && connectedWallet) {
            connectedWallet.textContent = shortAddress(addr);
            walletInfo.style.display = 'flex';
            walletInfo.style.animation = 'fadeIn 0.3s ease-out';
        }

        showToast('Wallet connected!', 'success');
    }

    async function updateCurrentUserBid() {
        if (!contract || !currentWallet) return;
        try {
            const addr = await signer.getAddress();
            const bidBn = await contract.bids(addr);
            currentUserBid = parseFloat(ethers.utils.formatEther(bidBn || 0));
            updateBidInfo();
        } catch (e) {
            console.error('Failed to fetch current user bid:', e);
        }
    }

    async function connectWallet() {
        if (typeof window.ethereum === 'undefined') {
            showToast('No MetaMask wallet detected. Install MetaMask to get started.', 'error');
            return false;
        }

        try {
            showLoading('Connecting wallet...');
            provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
            await provider.send('eth_requestAccounts', []);
            signer = provider.getSigner();
            contract = new ethers.Contract(contractAddress, contractABI, signer);
            const addr = await signer.getAddress();
            currentWallet = addr.toLowerCase();

            if (participantInfoEl) {
                participantInfoEl.textContent = `${user.name || 'User'} — ${shortAddress(addr)}`;
                participantInfoEl.style.animation = 'fadeIn 0.3s ease-out';
            }

            window.ethereum.on('accountsChanged', () => {
                showToast('Wallet changed, reloading...', 'warning');
                setTimeout(() => location.reload(), 1500);
            });
            window.ethereum.on('chainChanged', () => {
                showToast('Network changed, reloading...', 'warning');
                setTimeout(() => location.reload(), 1500);
            });

            await checkAuctionStatus();
            hideLoading();
            return true;
        } catch (e) {
            console.error('connect error', e);
            hideLoading();
            showToast('Wallet connection failed', 'error');
            return false;
        }
    }

    async function placeBid(bidInputEl, statusEl) {
        try {
            const val = (bidInputEl && bidInputEl.value) ? parseFloat(bidInputEl.value) : 0;
            
            // Validasi input
            if (!val || val <= 0) {
                showToast('Please enter a valid bid amount', 'error');
                if (statusEl) statusEl.innerHTML = '<div style="color: var(--danger);">❌ Masukkan jumlah bid yang valid</div>';
                return;
            }

            // Hitung total bid baru
            const newTotalBid = currentUserBid + val;

            // LOGIKA BARU: 
            // - Jika belum ada bidder (highestBid === 0 atau sangat kecil), minimum bid berlaku
            // - Jika sudah ada bidder, total akumulasi harus lebih tinggi dari highestBid
            if (!hasAnyBidder && newTotalBid < minBid) {
                showToast(`The highest bid right now is (${formatEth(highestBid)} ETH)`, 'error');
                if (statusEl) statusEl.innerHTML = `<div style="color: var(--danger);">Total bid must be higher than ${formatEth(highestBid)} ETH</div>`;
                return;
            }

            if (hasAnyBidder && newTotalBid <= highestBid) {
                showToast(`The highest bid right now is (${formatEth(highestBid)} ETH)`, 'error');
                if (statusEl) statusEl.innerHTML = `<div style="color: var(--danger);">Total bid must be higher than ${formatEth(highestBid)} ETH</div>`;
                return;
            }

            showLoading('Bid processing...');
            const overrides = { value: ethers.utils.parseEther(val.toString()) };
            const tx = await contract.bid(overrides);
            if (statusEl) {
                statusEl.innerHTML = '<div style="color: var(--info);">⏳ Waiting for confirmation...</div>';
            }

            const receipt = await tx.wait();
            
            // Update local state
            currentUserBid = newTotalBid;
            if (newTotalBid > highestBid) {
                highestBid = newTotalBid;
                hasAnyBidder = true;
            }
            
            hideLoading();

            if (statusEl) {
                statusEl.innerHTML = '<div style="color: var(--success); font-weight: 600;">✅ Bid successfully!</div>';
            }
            bidInputEl.value = '';
            
            // Update bid info display
            updateBidInfo();

            showToast('Bid successfully! 🎉', 'success');

            if (confirm('Bid successful! View transaction on Etherscan?')) {
                window.open(`https://sepolia.etherscan.io/tx/${receipt.transactionHash}`, '_blank');
            }
            
            // Refresh user bid from contract
            await updateCurrentUserBid();
        } catch (e) {
            console.error('placeBid error', e);
            hideLoading();
            const errorMsg = e?.error?.message || e?.message || String(e);
            showToast('Bid failed', 'error');
            if (statusEl) {
                statusEl.innerHTML = `<div style="color: var(--danger);">❌ Error</div>`;
            }
        }
    }

    async function withdraw(statusEl) {
        try {
            showLoading('Withdraw processing...');
            const tx = await contract.withdraw();
            if (statusEl) {
                statusEl.innerHTML = '<div style="color: var(--info);">⏳ Waiting for confirmation...</div>';
            }

            const receipt = await tx.wait();
            
            // Reset current user bid
            currentUserBid = 0;
            
            hideLoading();

            if (statusEl) {
                statusEl.innerHTML = '<div style="color: var(--success); font-weight: 600;">✅ Withdraw successfully!</div>';
            }
            
            updateBidInfo();

            const addr = await signer.getAddress();
            try {
                await fetch(`${backendUrl}/api/withdrawn`, {
                    method: 'POST',
                    headers: {'content-type': 'application/json'},
                    body: JSON.stringify({ walletAddress: addr, auctionId: user.id })
                });
            } catch (e) {
                console.warn('notify withdraw failed', e);
            }

            showToast('Withdraw successfully! 💰', 'success');

            if (confirm('Withdraw successfully! View transaction on Etherscan?')) {
                window.open(`https://sepolia.etherscan.io/tx/${receipt.transactionHash}`, '_blank');
            }
        } catch (e) {
            console.error('withdraw', e);
            hideLoading();
            const errorMsg = e?.error?.message || e?.message || String(e);
            showToast('Withdraw failed ', 'error');
            if (statusEl) {
                statusEl.innerHTML = `<div style="color: var(--danger);">❌ Error</div>`;
            }
        }
    }

    function initSocket() {
        const q = { id: user.id || 'unknown', name: user.name || 'Guest', mode: user.mode || 'watch' };
        const token = localStorage.getItem('auction_token');
            socket = io(location.origin, { 
                query: q,
                auth: { token }
            });

        socket.on('connect', async () => {
            console.log('socket connected');
            showToast('Server connected successfully', 'success');
            if (user.mode === 'bid') renderConnectPanel();
            if (contract) await checkAuctionStatus();
        });

        socket.on('disconnect', () => {
            showToast('Connection failed', 'warning');
        });

        socket.on('bidHistoryUpdate', history => renderBidHistory(history));
        socket.on('highestBidUpdate', (data) => {
            if (data.auctionId === user.id) {
                highestBid = data.amount;
                hasAnyBidder = data.amount > 0;
                updateBidInfo();
                console.log(`Highest bid updated for ${user.id}: ${highestBid}`);
            }
        });
        socket.on('timerUpdate', data => {
            if (data && typeof data === 'object' && typeof data.seconds === 'number' && data.id === user.id) {
                startLocalCountdown(data.seconds, data.ended || false);
            }
        });
    }

    function attachWalletToSocket(walletAddress) {
        if (!socket) return;
        try { socket.disconnect(); } catch {}
        const q = { id: user.id || 'unknown', name: user.name || 'Guest', mode: 'bid', walletAddress };
        socket = io(location.origin, { query: q });
        socket.on('bidHistoryUpdate', history => renderBidHistory(history));
        socket.on('highestBidUpdate', (data) => {
            if (data.auctionId === user.id) {
                highestBid = data.amount;
                hasAnyBidder = data.amount > 0;
                updateBidInfo();
                console.log(`Highest bid updated for ${user.id}: ${highestBid}`);
            }
        });
        socket.on('timerUpdate', data => {
            if (data && typeof data === 'object' && typeof data.seconds === 'number' && data.id === user.id) {
                startLocalCountdown(data.seconds, data.ended || false);
            }
        });
    }

    function renderBidHistory(history) {
        if (!bidList) return;
        bidList.innerHTML = '';

        if (!history || history.length === 0) {
            const li = document.createElement('li');
            li.className = 'no-bids';
            li.innerHTML = `
                <div class="no-bids-icon">🔭</div>
                <p>'No bids have been placed.<br>Be the first bidder!'</p>
            `;
            bidList.appendChild(li);
            if (bidCountEl) bidCountEl.textContent = '0';
            return;
        }

        const arr = [...history].sort((a, b) => (b.amount || 0) - (a.amount || 0));

        if (bidCountEl) {
            bidCountEl.textContent = arr.length;
            bidCountEl.style.animation = 'fadeIn 0.3s ease-out';
        }

        arr.forEach((p, idx) => {
            const li = document.createElement('li');
            li.className = 'bid-row';
            li.style.animationDelay = `${idx * 0.05}s`;

            const rank = document.createElement('div');
            rank.className = 'rank';
            rank.textContent = `#${idx + 1}`;

            const addrWrap = document.createElement('div');
            addrWrap.className = 'bidder-address';
            const addrDisplay = document.createElement('span');
            addrDisplay.className = 'address-display';
            addrDisplay.textContent = p.walletAddress ? shortAddress(p.walletAddress) : '—';

            const amount = document.createElement('div');
            amount.className = 'bid-amount';
            amount.textContent = `${formatEth(p.amount)} ETH`;

            addrWrap.appendChild(addrDisplay);
            li.appendChild(rank);
            li.appendChild(addrWrap);
            li.appendChild(amount);
            bidList.appendChild(li);
        });
    }

    function startLocalCountdown(seconds, ended = false) {
        timeLeftSeconds = Math.max(0, Math.floor(seconds));

        if (ended || timeLeftSeconds <= 0) {
            renderTime(0, true);
            if (auctionStatusEl) {
                auctionStatusEl.textContent = '🔴 Live Ended';
                auctionStatusEl.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                auctionStatusEl.style.color = 'white';
            }
            disableBiddingControls();
            return;
        }

        if (auctionStatusEl && !auctionStatusEl.textContent.includes('Ended')) {
            auctionStatusEl.textContent = '🟢 Live Now';
            auctionStatusEl.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            auctionStatusEl.style.color = 'white';
        }

        renderTime(timeLeftSeconds, false);

        if (localTimerInterval) clearInterval(localTimerInterval);

        localTimerInterval = setInterval(() => {
            if (timeLeftSeconds > 0) {
                timeLeftSeconds--;
                renderTime(timeLeftSeconds, false);

                if (timeLeftSeconds <= 60 && timerEl) {
                    timerEl.classList.add('urgent');
                }
            } else {
                renderTime(0, true);
                if (auctionStatusEl) {
                    auctionStatusEl.textContent = '🔴 Live Ended';
                    auctionStatusEl.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                }
                clearInterval(localTimerInterval);
                localTimerInterval = null;
                disableBiddingControls();
                showToast('Auction has ended!', 'warning');
            }
        }, 1000);
    }

    function renderTime(sec, ended = false) {
        if (!timerEl) return;
        if (ended || sec <= 0) {
            timerEl.textContent = '⏱️ Selesai';
            timerEl.style.color = 'var(--danger)';
            return;
        }
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
        const s = (sec % 60).toString().padStart(2, '0');
        timerEl.textContent = h > 0 ? `⏱️ ${h}:${m}:${s}` : `⏱️ ${m}:${s}`;
    }

    function disableBiddingControls() {
        const bidButton = document.getElementById('bidButton');
        const withdrawButton = document.getElementById('withdrawButton');
        const bidAmount = document.getElementById('bidAmount');

        if (bidButton) {
            bidButton.disabled = true;
            bidButton.style.cursor = 'not-allowed';
            bidButton.style.opacity = '0.5';
            bidButton.title = 'Auction has ended';
        }
        if (withdrawButton) {
            withdrawButton.disabled = true;
            withdrawButton.style.cursor = 'not-allowed';
            withdrawButton.style.opacity = '0.5';
            withdrawButton.title = 'Auction has ended';
        }
        if (bidAmount) {
            bidAmount.disabled = true;
        }
    }

    async function checkAuctionStatus() {
        try {
            const endTime = await contract.auctionEndTime();
            const now = Math.floor(Date.now() / 1000);
            if (now > endTime) {
                if (auctionStatusEl) {
                    auctionStatusEl.textContent = '🔴 Live Ended';
                    auctionStatusEl.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
                }
                showToast('Auction has ended. You will be redirected to the main page.', 'warning');
                setTimeout(() => {
                    window.location.href = '/';
                }, 3000);
            } else if (auctionStatusEl) {
                auctionStatusEl.textContent = '🟢 Live Now';
                auctionStatusEl.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            }
        } catch (e) {
            console.error('checkAuctionStatus error', e);
        }
    }

    function shortAddress(a) {
        if (!a) return '—';
        try {
            return `${a.substring(0, 6)}...${a.substring(a.length - 4)}`;
        } catch {
            return a;
        }
    }

    function formatEth(v) {
        const n = Number(v) || 0;
        return parseFloat(n.toFixed(6)).toString();
    }
});