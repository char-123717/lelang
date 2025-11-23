// Enhanced script.js with fixed initial load
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication first
    const token = localStorage.getItem('auction_token');

    if (!token) {
        // No token, redirect to signin
        window.location.href = '/signin.html';
        return;
    }

    // Verify token validity
    try {
        const verifyResponse = await fetch('/api/auth/verify', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!verifyResponse.ok) {
            // Invalid token, clear and redirect
            localStorage.removeItem('auction_token');
            localStorage.removeItem('auction_user');
            window.location.href = '/signin.html';
            return;
        }

        // Check if user needs to reset password (used temporary password)
        const verifyData = await verifyResponse.json();
        if (verifyData?.user?.requires_password_reset) {
            window.location.href = '/reset.html';
            return;
        }
    } catch (error) {
        console.error('Token verification failed:', error);
        window.location.href = '/signin.html';
        return;
    }

    const auctionCards = document.querySelectorAll('.auction-card');
    const nameModal = document.getElementById('nameModal');
    const participantNameInput = document.getElementById('participantName');
    const modalConfirmButton = document.getElementById('modalConfirmButton');
    const modalCancelButton = document.getElementById('modalCancelButton');
    const toastContainer = document.getElementById('toastContainer');

    let selectedAuctionId = null;
    let selectedMode = null;
    const countdownStates = {};
    const backendUrl = location.origin;

    // Initialize Socket.IO with lobby room
    const socket = io(location.origin, {
        query: { id: 'lobby' },
        auth: { token }
    });
  
    // Toast Notification Function
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
      
      if (toastContainer) {
        toastContainer.appendChild(toast);
        
        setTimeout(() => {
          toast.style.animation = 'slideInUp 0.3s ease-out reverse';
          setTimeout(() => toast.remove(), 300);
        }, 3000);
      }
    }
  
    // Animate stats on load
    function animateValue(element, start, end, duration) {
      if (!element) return;
      let startTimestamp = null;
      const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const value = progress * (end - start) + start;
        element.textContent = typeof end === 'number' && end % 1 !== 0 
          ? value.toFixed(4) 
          : Math.floor(value);
        if (progress < 1) {
          window.requestAnimationFrame(step);
        }
      };
      window.requestAnimationFrame(step);
    }

    // FETCH INITIAL DATA FROM API
    async function fetchInitialAuctionData(auctionId) {
      try {
        const response = await fetch(`${backendUrl}/api/auction-details?id=${auctionId}`);
        const data = await response.json();
        
        if (data.ok) {
          const card = document.querySelector(`.auction-card[data-auction-id='${auctionId}']`);
          if (!card) return;
          
          const priceEl = card.querySelector('.price');
          const timerEl = card.querySelector('.timer');
          const statusLive = card.querySelector('.card-status-live');
          const joinBtn = card.querySelector('.btn-join');
          
          // Update price
          if (priceEl) {
            priceEl.textContent = `${formatEth(data.highestBid)} ETH`;
          }
          
          // Calculate time left
          const timeLeft = Math.max(0, data.auctionEndTime - Math.floor(Date.now() / 1000));
          const ended = data.ended || timeLeft <= 0;
          
          // Update status and timer
          if (ended) {
            if (timerEl) {
              timerEl.textContent = 'Selesai';
              timerEl.style.color = 'var(--danger)';
            }
            if (statusLive) {
              statusLive.innerHTML = '🔴 Ended';
              statusLive.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            }
            if (joinBtn) {
              joinBtn.disabled = true;
              joinBtn.style.cursor = 'not-allowed';
              joinBtn.style.opacity = '0.5';
            }
          } else {
            if (statusLive) {
              statusLive.innerHTML = '🟢 Live Now';
              statusLive.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
            }
            if (joinBtn) {
              joinBtn.disabled = false;
              joinBtn.style.cursor = 'pointer';
              joinBtn.style.opacity = '1';
            }
            if (timerEl) {
              startLocalCountdown(auctionId, timeLeft, timerEl, false, statusLive, joinBtn);
            }
          }
          
          console.log(`Initial data loaded for auction ${auctionId}:`, data);
        }
      } catch (e) {
        console.error(`Failed to fetch initial data for auction ${auctionId}:`, e);
      }
    }

    // Load initial data for all auctions
    await Promise.all([
      fetchInitialAuctionData('101'),
      fetchInitialAuctionData('102')
    ]);
  
    // Listen for auction state updates from server
    socket.on('auctionStateUpdate', (data) => {
      const { auctionId, highestBid, ended, timeLeft } = data;
      console.log('Auction state update received:', data);
      
      const card = document.querySelector(`.auction-card[data-auction-id='${auctionId}']`);
      if (!card) return;
      
      const priceEl = card.querySelector('.price');
      const timerEl = card.querySelector('.timer');
      const statusLive = card.querySelector('.card-status-live');
      const joinBtn = card.querySelector('.btn-join');
      
      // Update price with animation
      if (priceEl && highestBid !== undefined) {
        const currentPrice = parseFloat(priceEl.textContent.replace(' ETH', ''));
        if (currentPrice !== highestBid) {
          priceEl.style.transition = 'all 0.3s ease';
          priceEl.style.transform = 'scale(1.15)';
          priceEl.style.color = 'var(--accent)';
          priceEl.textContent = `${formatEth(highestBid)} ETH`;
          setTimeout(() => {
            priceEl.style.transform = 'scale(1)';
            priceEl.style.color = 'var(--success)';
          }, 300);
        }
      }
      
      // Update timer and status
      if (timerEl && statusLive && joinBtn) {
        if (ended) {
          timerEl.textContent = 'Selesai';
          timerEl.style.color = 'var(--danger)';
          statusLive.innerHTML = '🔴 Ended';
          statusLive.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
          joinBtn.disabled = true;
          joinBtn.style.cursor = 'not-allowed';
          joinBtn.style.opacity = '0.5';
          joinBtn.title = 'Auction has ended';
          
          // Clear countdown if exists
          if (countdownStates[auctionId] && countdownStates[auctionId].interval) {
            clearInterval(countdownStates[auctionId].interval);
            countdownStates[auctionId].interval = null;
          }
        } else if (timeLeft !== undefined) {
          startLocalCountdown(auctionId, timeLeft, timerEl, false, statusLive, joinBtn);
        }
      }
    });
  
    // Socket event listeners untuk update real-time
    socket.on('timerUpdate', (data) => {
      if (data && typeof data === 'object' && data.id && typeof data.seconds === 'number') {
        const card = document.querySelector(`.auction-card[data-auction-id="${data.id}"]`);
        if (card) {
          const timerEl = card.querySelector('.timer');
          const joinBtn = card.querySelector('.btn-join');
          const statusLive = card.querySelector('.card-status-live');
          if (timerEl) {
            startLocalCountdown(data.id, data.seconds, timerEl, data.ended, statusLive, joinBtn);
          }
        }
      }
    });
  
    // Request initial data ketika socket connect
    socket.on('connect', () => {
      console.log('Socket connected to lobby');
      showToast('Terhubung ke server', 'success');
    });
  
    socket.on('disconnect', () => {
      showToast('Koneksi terputus', 'warning');
    });
  
    // Initialize auction cards
    auctionCards.forEach((card, index) => {
      const id = card.dataset.auctionId;
      const join = card.querySelector('.btn-join');
      const watch = card.querySelector('.btn-watch');
  
      // Add entrance animation delay
      card.style.animationDelay = `${index * 0.1}s`;
  
      if (join) {
        join.addEventListener('click', () => {
          if (!join.disabled) {
            openModal(id, 'bid');
          }
        });
      }
      if (watch) {
        watch.addEventListener('click', () => openModal(id, 'watch'));
      }
    });
  
    function openModal(id, mode) {
      selectedAuctionId = id;
      selectedMode = mode;
      nameModal.style.display = 'flex';
      nameModal.style.animation = 'fadeIn 0.2s ease-out';
      participantNameInput.focus();
      participantNameInput.value = '';
    }
  
    function closeModal() {
      nameModal.style.animation = 'fadeIn 0.2s ease-out reverse';
      setTimeout(() => {
        nameModal.style.display = 'none';
      }, 200);
      participantNameInput.value = '';
    }
  
    function startLocalCountdown(id, seconds, timerEl, ended = false, statusLive = null, joinBtn = null) {
      let timeLeftSeconds = Math.max(0, Math.floor(seconds));
      
      if (ended || timeLeftSeconds <= 0) {
        renderTime(0, timerEl, true);
        if (statusLive) {
          statusLive.innerHTML = '🔴 Ended';
          statusLive.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
        }
        if (joinBtn) {
          joinBtn.disabled = true;
          joinBtn.style.cursor = 'not-allowed';
          joinBtn.style.opacity = '0.5';
          joinBtn.title = 'Auction has ended';
        }
        return;
      }
      
      if (statusLive && !statusLive.textContent.includes('Ended')) {
        statusLive.innerHTML = '🟢 Live Now';
        statusLive.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
      }
      
      if (joinBtn) {
        joinBtn.disabled = false;
        joinBtn.style.cursor = 'pointer';
        joinBtn.style.opacity = '1';
      }
      
      renderTime(timeLeftSeconds, timerEl, false);
  
      // Clear existing interval if any
      if (countdownStates[id] && countdownStates[id].interval) {
        clearInterval(countdownStates[id].interval);
      }
  
      // Create new countdown
      countdownStates[id] = {
        seconds: timeLeftSeconds,
        interval: setInterval(() => {
          if (timeLeftSeconds > 0) {
            timeLeftSeconds--;
            countdownStates[id].seconds = timeLeftSeconds;
            renderTime(timeLeftSeconds, timerEl, false);
            
            // Add urgent class when less than 60 seconds
            if (timeLeftSeconds <= 60 && timerEl) {
              timerEl.style.color = 'var(--danger)';
              timerEl.style.fontWeight = '700';
            }
          } else {
            renderTime(0, timerEl, true);
            if (statusLive) {
              statusLive.innerHTML = '🔴 Ended';
              statusLive.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
            }
            clearInterval(countdownStates[id].interval);
            countdownStates[id].interval = null;
            
            // Disable Join Bid button when time is up
            if (joinBtn) {
              joinBtn.disabled = true;
              joinBtn.style.cursor = 'not-allowed';
              joinBtn.style.opacity = '0.5';
              joinBtn.title = 'Auction has ended';
            }
            
            showToast(`Lelang ${id === '101' ? 'Etherwave' : 'Satoshi'} telah berakhir!`, 'warning');
          }
        }, 1000)
      };
    }
  
    function renderTime(sec, timerEl, ended = false) {
      if (!timerEl) return;
      if (ended || sec <= 0) {
        timerEl.textContent = 'Selesai';
        timerEl.style.color = 'var(--danger)';
        return;
      }
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
      const s = (sec % 60).toString().padStart(2, '0');
      timerEl.textContent = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
      timerEl.style.color = sec <= 60 ? 'var(--danger)' : 'var(--primary)';
    }
  
    function formatEth(v) {
      const n = Number(v) || 0;
      return parseFloat(n.toFixed(6)).toString();
    }
  
    modalConfirmButton.addEventListener('click', async () => {
      const name = participantNameInput.value.trim();
      if (!name) {
        showToast('Masukkan nama terlebih dahulu', 'error');
        participantNameInput.focus();
        return;
      }
      if (name.length > 10) {
        showToast('Nama tidak boleh lebih dari 10 karakter', 'error');
        return;
      }
      if (!/^[A-Za-z]+$/.test(name)) {
        showToast('Nama hanya boleh berisi huruf', 'error');
        return;
      }
      
      console.log('Redirecting with name:', name);
      
      // Show loading state
      modalConfirmButton.disabled = true;
      modalConfirmButton.textContent = '⏳ Loading...';
      
      const url = `auction.html?id=${selectedAuctionId}&name=${encodeURIComponent(name)}&mode=${selectedMode}`;
      
      // Smooth transition
      setTimeout(() => {
        window.location.href = url;
      }, 300);
    });
  
    modalCancelButton.addEventListener('click', closeModal);
  
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nameModal.style.display === 'flex') {
        closeModal();
      }
    });
  
    // Close modal on overlay click
    nameModal.addEventListener('click', (e) => {
      if (e.target === nameModal) {
        closeModal();
      }
    });
  
    // Input validation
    participantNameInput.addEventListener('input', (e) => {
      // Restrict input to letters only
      participantNameInput.value = e.target.value.replace(/[^A-Za-z]/g, '');
      if (participantNameInput.value.length > 10) {
        participantNameInput.value = participantNameInput.value.slice(0, 10);
      }
    });
  
    // Enter key to confirm
    participantNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        modalConfirmButton.click();
      }
    });
  
    // Animate hero stats on load
    setTimeout(() => {
      const activeAuctionsEl = document.getElementById('activeAuctions');
      const totalBiddersEl = document.getElementById('totalBidders');
      
      if (activeAuctionsEl) animateValue(activeAuctionsEl, 0, 2, 1000);
      if (totalBiddersEl) animateValue(totalBiddersEl, 0, 0, 1000);
    }, 500);
});