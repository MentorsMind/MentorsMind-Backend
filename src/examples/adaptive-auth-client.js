/**
 * Adaptive Authentication Client SDK
 * 
 * This is an example client-side implementation for integrating with the
 * adaptive authentication system. It handles biometric data collection,
 * challenge responses, and continuous monitoring.
 */

class AdaptiveAuthClient {
  constructor(config = {}) {
    this.apiBase = config.apiBase || '/api/v1/adaptive-auth';
    this.sessionId = config.sessionId || this.generateSessionId();
    this.biometricCollector = new BiometricCollector();
    this.isMonitoring = false;
    this.monitoringInterval = null;
    this.config = {
      collectBiometrics: config.collectBiometrics !== false,
      monitoringInterval: config.monitoringInterval || 30000, // 30 seconds
      maxBiometricSamples: config.maxBiometricSamples || 1000,
      ...config
    };
  }

  /**
   * Start collecting biometric data and continuous monitoring
   */
  async initialize() {
    if (this.config.collectBiometrics) {
      this.biometricCollector.startCollection();
    }

    // Submit initial biometric sample if available
    const initialSample = this.biometricCollector.getSample();
    if (initialSample && this.hasSignificantData(initialSample)) {
      await this.submitBiometricSample(initialSample);
    }
  }

  /**
   * Perform adaptive authentication check
   */
  async authenticate(context = {}) {
    try {
      const biometricData = this.config.collectBiometrics 
        ? this.biometricCollector.getSample() 
        : null;

      const response = await this.apiRequest('/risk/assess', {
        method: 'POST',
        body: JSON.stringify({
          ...context,
          biometricData,
          sessionId: this.sessionId
        })
      });

      return response.data;
    } catch (error) {
      console.error('Adaptive authentication failed:', error);
      throw error;
    }
  }

  /**
   * Handle authentication challenges
   */
  async handleChallenges(challenges) {
    const results = [];

    for (const challenge of challenges) {
      try {
        const response = await this.handleSingleChallenge(challenge);
        const result = await this.submitChallengeResponse(challenge.id, response);
        results.push({ challengeId: challenge.id, success: true, result });
      } catch (error) {
        console.error(`Challenge ${challenge.id} failed:`, error);
        results.push({ challengeId: challenge.id, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Handle individual challenge types
   */
  async handleSingleChallenge(challenge) {
    switch (challenge.type) {
      case 'mfa':
        return await this.handleMfaChallenge(challenge);
      
      case 'email_verification':
        return await this.handleEmailVerificationChallenge(challenge);
      
      case 'sms_verification':
        return await this.handleSmsVerificationChallenge(challenge);
      
      case 'device_confirmation':
        return await this.handleDeviceConfirmationChallenge(challenge);
      
      case 'biometric':
        return await this.handleBiometricChallenge(challenge);
      
      case 'security_questions':
        return await this.handleSecurityQuestionsChallenge(challenge);
      
      default:
        throw new Error(`Unsupported challenge type: ${challenge.type}`);
    }
  }

  /**
   * MFA Challenge Handler
   */
  async handleMfaChallenge(challenge) {
    const token = await this.promptUser({
      type: 'input',
      message: 'Enter your MFA code:',
      placeholder: '123456',
      inputType: 'number',
      maxLength: 6
    });

    return { token };
  }

  /**
   * Email Verification Challenge Handler
   */
  async handleEmailVerificationChallenge(challenge) {
    const code = await this.promptUser({
      type: 'input',
      message: 'Check your email for a verification code:',
      placeholder: 'Enter code',
      inputType: 'text'
    });

    return { code };
  }

  /**
   * SMS Verification Challenge Handler
   */
  async handleSmsVerificationChallenge(challenge) {
    const code = await this.promptUser({
      type: 'input',
      message: 'Enter the SMS verification code:',
      placeholder: 'Enter code',
      inputType: 'text'
    });

    return { code };
  }

  /**
   * Device Confirmation Challenge Handler
   */
  async handleDeviceConfirmationChallenge(challenge) {
    const confirmed = await this.promptUser({
      type: 'confirm',
      message: 'Do you want to trust this device for future logins?',
      confirmText: 'Trust Device',
      cancelText: 'Not Now'
    });

    return { confirmed };
  }

  /**
   * Biometric Challenge Handler
   */
  async handleBiometricChallenge(challenge) {
    await this.promptUser({
      type: 'info',
      message: 'Please continue typing and using your device normally to verify your identity.',
      timeout: 5000
    });

    // Collect fresh biometric data
    const biometricData = await this.collectFreshBiometricSample();
    return { biometricData };
  }

  /**
   * Security Questions Challenge Handler
   */
  async handleSecurityQuestionsChallenge(challenge) {
    const questions = challenge.metadata?.questions || [];
    const answers = [];

    for (const question of questions) {
      const answer = await this.promptUser({
        type: 'input',
        message: question,
        inputType: 'text',
        required: true
      });
      answers.push(answer);
    }

    return { answers };
  }

  /**
   * Submit challenge response to server
   */
  async submitChallengeResponse(challengeId, response) {
    return await this.apiRequest('/challenge/respond', {
      method: 'POST',
      body: JSON.stringify({
        challengeId,
        response,
        sessionId: this.sessionId
      })
    });
  }

  /**
   * Start continuous monitoring
   */
  async startContinuousMonitoring() {
    if (this.isMonitoring) return;

    try {
      await this.apiRequest('/monitoring/start', {
        method: 'POST',
        headers: { 'X-Session-Id': this.sessionId },
        body: JSON.stringify({
          biometricData: this.config.collectBiometrics 
            ? this.biometricCollector.getSample() 
            : null
        })
      });

      this.isMonitoring = true;
      this.startMonitoringHeartbeat();
    } catch (error) {
      console.error('Failed to start continuous monitoring:', error);
    }
  }

  /**
   * Stop continuous monitoring
   */
  async stopContinuousMonitoring() {
    if (!this.isMonitoring) return;

    try {
      await this.apiRequest('/monitoring/stop', {
        method: 'POST',
        headers: { 'X-Session-Id': this.sessionId }
      });

      this.isMonitoring = false;
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
    } catch (error) {
      console.error('Failed to stop continuous monitoring:', error);
    }
  }

  /**
   * Start monitoring heartbeat
   */
  startMonitoringHeartbeat() {
    this.monitoringInterval = setInterval(async () => {
      try {
        const response = await this.apiRequest('/monitoring/heartbeat', {
          method: 'POST',
          headers: { 'X-Session-Id': this.sessionId },
          body: JSON.stringify({
            biometricData: this.config.collectBiometrics 
              ? this.biometricCollector.getSample() 
              : null
          })
        });

        if (response.data.needsReauth) {
          await this.handleChallenges(response.data.challenges);
        }
      } catch (error) {
        console.error('Monitoring heartbeat failed:', error);
      }
    }, this.config.monitoringInterval);
  }

  /**
   * Submit biometric training sample
   */
  async submitBiometricSample(biometricData) {
    try {
      await this.apiRequest('/biometric/train', {
        method: 'POST',
        body: JSON.stringify({ biometricData })
      });
    } catch (error) {
      console.error('Failed to submit biometric sample:', error);
    }
  }

  /**
   * Collect fresh biometric sample with timeout
   */
  async collectFreshBiometricSample(timeout = 10000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const collector = new BiometricCollector();
      
      collector.startCollection();
      
      const checkInterval = setInterval(() => {
        const sample = collector.getSample();
        const elapsed = Date.now() - startTime;
        
        if (this.hasSignificantData(sample) || elapsed >= timeout) {
          clearInterval(checkInterval);
          collector.stopCollection();
          resolve(sample);
        }
      }, 500);
      
      setTimeout(() => {
        clearInterval(checkInterval);
        collector.stopCollection();
        reject(new Error('Biometric collection timeout'));
      }, timeout);
    });
  }

  /**
   * Check if biometric data has significant samples
   */
  hasSignificantData(biometricData) {
    if (!biometricData) return false;
    
    const keystrokeCount = biometricData.keystrokeDynamics?.dwellTimes?.length || 0;
    const mouseCount = biometricData.mouseMovements?.length || 0;
    const touchCount = biometricData.touchPatterns?.length || 0;
    
    return keystrokeCount >= 10 || mouseCount >= 20 || touchCount >= 5;
  }

  /**
   * Make API request with authentication
   */
  async apiRequest(endpoint, options = {}) {
    const token = this.getAuthToken();
    
    const response = await fetch(`${this.apiBase}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Session-Id': this.sessionId,
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get authentication token (implement based on your auth system)
   */
  getAuthToken() {
    // Implementation depends on your authentication system
    return localStorage.getItem('authToken') || 
           sessionStorage.getItem('authToken') ||
           document.cookie.match(/authToken=([^;]+)/)?.[1];
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Prompt user for input (implement based on your UI framework)
   */
  async promptUser(config) {
    // This is a simple implementation - replace with your UI framework
    return new Promise((resolve, reject) => {
      if (config.type === 'confirm') {
        const result = window.confirm(config.message);
        resolve(result);
      } else if (config.type === 'input') {
        const result = window.prompt(config.message, config.placeholder || '');
        if (result === null) {
          reject(new Error('User cancelled'));
        } else {
          resolve(result);
        }
      } else if (config.type === 'info') {
        alert(config.message);
        setTimeout(() => resolve(), config.timeout || 0);
      }
    });
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.stopContinuousMonitoring();
    this.biometricCollector.stopCollection();
  }
}

/**
 * Biometric Data Collector
 */
class BiometricCollector {
  constructor() {
    this.keystrokeData = [];
    this.mouseData = [];
    this.touchData = [];
    this.scrollData = [];
    this.isCollecting = false;
    
    // Bind event handlers
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseClick = this.handleMouseClick.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.handleScroll = this.handleScroll.bind(this);
    
    this.keystrokeStart = null;
    this.lastKeystroke = null;
  }

  /**
   * Start collecting biometric data
   */
  startCollection() {
    if (this.isCollecting) return;
    
    this.isCollecting = true;
    
    // Keyboard events
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
    
    // Mouse events
    document.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('click', this.handleMouseClick);
    
    // Touch events (for mobile)
    document.addEventListener('touchstart', this.handleTouchStart);
    document.addEventListener('touchend', this.handleTouchEnd);
    
    // Scroll events
    window.addEventListener('scroll', this.handleScroll);
  }

  /**
   * Stop collecting biometric data
   */
  stopCollection() {
    if (!this.isCollecting) return;
    
    this.isCollecting = false;
    
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('click', this.handleMouseClick);
    document.removeEventListener('touchstart', this.handleTouchStart);
    document.removeEventListener('touchend', this.handleTouchEnd);
    window.removeEventListener('scroll', this.handleScroll);
  }

  /**
   * Keystroke event handlers
   */
  handleKeyDown(event) {
    if (!this.isCollecting) return;
    
    this.keystrokeStart = Date.now();
  }

  handleKeyUp(event) {
    if (!this.isCollecting || !this.keystrokeStart) return;
    
    const now = Date.now();
    const dwellTime = now - this.keystrokeStart;
    const flightTime = this.lastKeystroke ? now - this.lastKeystroke : 0;
    
    this.keystrokeData.push({
      key: event.key,
      code: event.code,
      dwellTime,
      flightTime,
      timestamp: now
    });
    
    this.lastKeystroke = now;
    this.keystrokeStart = null;
    
    // Limit data size
    if (this.keystrokeData.length > 200) {
      this.keystrokeData = this.keystrokeData.slice(-150);
    }
  }

  /**
   * Mouse event handlers
   */
  handleMouseMove(event) {
    if (!this.isCollecting) return;
    
    this.mouseData.push({
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now()
    });
    
    // Limit data size
    if (this.mouseData.length > 500) {
      this.mouseData = this.mouseData.slice(-300);
    }
  }

  handleMouseClick(event) {
    if (!this.isCollecting) return;
    
    this.mouseData.push({
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now(),
      event: 'click',
      button: event.button
    });
  }

  /**
   * Touch event handlers
   */
  handleTouchStart(event) {
    if (!this.isCollecting) return;
    
    Array.from(event.touches).forEach(touch => {
      this.touchData.push({
        x: touch.clientX,
        y: touch.clientY,
        pressure: touch.force || 1,
        area: touch.radiusX * touch.radiusY * Math.PI || 100,
        timestamp: Date.now(),
        event: 'start',
        gestureType: 'tap'
      });
    });
  }

  handleTouchEnd(event) {
    if (!this.isCollecting) return;
    
    Array.from(event.changedTouches).forEach(touch => {
      this.touchData.push({
        x: touch.clientX,
        y: touch.clientY,
        pressure: touch.force || 0,
        area: touch.radiusX * touch.radiusY * Math.PI || 100,
        duration: 0, // Calculate based on start time
        timestamp: Date.now(),
        event: 'end',
        gestureType: 'tap'
      });
    });
    
    // Limit data size
    if (this.touchData.length > 200) {
      this.touchData = this.touchData.slice(-150);
    }
  }

  /**
   * Scroll event handler
   */
  handleScroll(event) {
    if (!this.isCollecting) return;
    
    this.scrollData.push({
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      timestamp: Date.now()
    });
    
    // Limit data size
    if (this.scrollData.length > 100) {
      this.scrollData = this.scrollData.slice(-50);
    }
  }

  /**
   * Get collected biometric sample
   */
  getSample() {
    return {
      keystrokeDynamics: this.processKeystrokeData(),
      mouseMovements: this.mouseData.slice(-100),
      touchPatterns: this.touchData.slice(-50),
      scrollBehavior: this.processScrollData(),
      typingPattern: this.processTypingPattern()
    };
  }

  /**
   * Process keystroke data into dynamics
   */
  processKeystrokeData() {
    if (this.keystrokeData.length === 0) return null;
    
    const dwellTimes = this.keystrokeData.map(k => k.dwellTime);
    const flightTimes = this.keystrokeData.filter(k => k.flightTime > 0).map(k => k.flightTime);
    
    return {
      dwellTimes,
      flightTimes,
      rhythm: this.calculateTypingRhythm(),
      typingSpeed: this.calculateTypingSpeed(),
      pausePatterns: this.identifyPausePatterns()
    };
  }

  /**
   * Process scroll behavior
   */
  processScrollData() {
    if (this.scrollData.length < 2) return null;
    
    const velocities = [];
    for (let i = 1; i < this.scrollData.length; i++) {
      const prev = this.scrollData[i - 1];
      const curr = this.scrollData[i];
      const dy = curr.scrollY - prev.scrollY;
      const dt = curr.timestamp - prev.timestamp;
      if (dt > 0) {
        velocities.push(dy / dt);
      }
    }
    
    return {
      velocity: velocities.reduce((a, b) => a + b, 0) / velocities.length,
      acceleration: this.calculateAcceleration(velocities),
      direction: velocities[velocities.length - 1] > 0 ? 'down' : 'up',
      pattern: this.classifyScrollPattern(velocities),
      pauseFrequency: this.calculateScrollPauses()
    };
  }

  /**
   * Process typing patterns
   */
  processTypingPattern() {
    if (this.keystrokeData.length === 0) return null;
    
    const chars = this.keystrokeData.map(k => k.key).filter(k => k.length === 1);
    const words = this.identifyWords(chars);
    
    return {
      avgWordLength: words.length > 0 ? words.reduce((a, b) => a + b.length, 0) / words.length : 0,
      commonMistakes: this.identifyCommonMistakes(),
      correctionPatterns: this.identifyCorrections(),
      preferredKeys: this.identifyPreferredKeys(),
      handednessIndicators: this.analyzeHandedness()
    };
  }

  /**
   * Helper methods for data processing
   */
  calculateTypingRhythm() {
    if (this.keystrokeData.length < 3) return 0;
    
    const intervals = [];
    for (let i = 1; i < this.keystrokeData.length; i++) {
      intervals.push(this.keystrokeData[i].timestamp - this.keystrokeData[i-1].timestamp);
    }
    
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / intervals.length;
    
    return 1 / (1 + Math.sqrt(variance)); // Higher score = more consistent rhythm
  }

  calculateTypingSpeed() {
    if (this.keystrokeData.length < 2) return 0;
    
    const timeSpan = this.keystrokeData[this.keystrokeData.length - 1].timestamp - this.keystrokeData[0].timestamp;
    const characters = this.keystrokeData.filter(k => k.key.length === 1).length;
    
    // Words per minute (assuming 5 characters per word)
    return (characters / 5) / (timeSpan / 60000);
  }

  calculateAcceleration(velocities) {
    if (velocities.length < 2) return 0;
    
    const accelerations = [];
    for (let i = 1; i < velocities.length; i++) {
      accelerations.push(velocities[i] - velocities[i-1]);
    }
    
    return accelerations.reduce((a, b) => a + b, 0) / accelerations.length;
  }

  // Additional helper methods would be implemented here...
  classifyScrollPattern() { return 'smooth'; }
  calculateScrollPauses() { return 0; }
  identifyPausePatterns() { return []; }
  identifyWords() { return []; }
  identifyCommonMistakes() { return []; }
  identifyCorrections() { return []; }
  identifyPreferredKeys() { return []; }
  analyzeHandedness() { return { leftHandDominance: 0.5, rightHandDominance: 0.5 }; }
}

// Usage Example
(function() {
  // Initialize adaptive auth client
  const authClient = new AdaptiveAuthClient({
    apiBase: '/api/v1/adaptive-auth',
    collectBiometrics: true,
    monitoringInterval: 30000
  });

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await authClient.initialize();
      console.log('Adaptive authentication initialized');
    } catch (error) {
      console.error('Failed to initialize adaptive auth:', error);
    }
  });

  // Example: Protect sensitive form submission
  document.getElementById('sensitive-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    
    try {
      // Check authentication before submission
      const riskAssessment = await authClient.authenticate({
        actionType: 'sensitive_form_submission',
        isPrivilegedAction: true
      });
      
      console.log('Risk assessment:', riskAssessment);
      
      // Proceed with form submission
      event.target.submit();
    } catch (error) {
      if (error.challenges) {
        // Handle authentication challenges
        await authClient.handleChallenges(error.challenges);
      } else {
        console.error('Authentication failed:', error);
      }
    }
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    authClient.cleanup();
  });

  // Export for global use
  window.AdaptiveAuthClient = AdaptiveAuthClient;
})();