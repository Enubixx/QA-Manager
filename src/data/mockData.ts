import { TestPlan, TestRun, BugLog } from '../types';

export const INITIAL_PLANS: TestPlan[] = [];
export const INITIAL_BUG_LOGS: BugLog[] = [];
export const INITIAL_RUNS: TestRun[] = [];

export const SAMPLE_PLANS: TestPlan[] = [
  {
    id: 'plan-demo-1',
    name: 'Mobile Auth & SSO Authentication Suite',
    description: 'Verify login flows, OAuth provider single sign-on, token refresh, and session logout across mobile devices.',
    createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    steps: [
      {
        id: 'step-demo-101',
        title: 'Launch Mobile App & Open Splash Screen',
        feature: 'Authentication',
        description: 'Open app from fresh install or cleared state and verify initial splash animation and loading indicators.',
        expectedOutcome: 'Splash screen presents within 1.5 seconds and transitions cleanly to the welcome authentication screen.'
      },
      {
        id: 'step-demo-102',
        title: 'Tap "Sign in with Google SSO"',
        feature: 'Authentication',
        description: 'Tap Google sign-in button and grant OAuth permissions via external system browser sheet.',
        expectedOutcome: 'Google Account picker opens successfully, user authenticates, and is redirected back with valid bearer token.'
      },
      {
        id: 'step-demo-103',
        title: 'Verify Two-Factor OTP Verification Code Prompt',
        feature: 'Security',
        description: 'Enter 6-digit SMS verification code received on device.',
        expectedOutcome: 'Code is automatically recognized from SMS autofill and proceeds to main user feed.'
      },
      {
        id: 'step-demo-104',
        title: 'Execute User Logout Action',
        feature: 'Authentication',
        description: 'Navigate to Settings -> Account -> Logout and confirm logout modal prompt.',
        expectedOutcome: 'Session token cleared from secure storage and user returned to onboarding screen.'
      }
    ]
  },
  {
    id: 'plan-demo-2',
    name: 'E-Commerce Mobile Checkout & Payment Flow',
    description: 'End-to-end field testing for cart item selection, address auto-complete, coupon applying, and Stripe/Apple Pay checkout.',
    createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    steps: [
      {
        id: 'step-demo-201',
        title: 'Add Product Items to Shopping Cart',
        feature: 'Cart',
        description: 'Select variant options (Size/Color) on product detail page and tap "Add to Cart".',
        expectedOutcome: 'Cart badge increments by 1, toast message displays confirmation, and item appears in cart draw.'
      },
      {
        id: 'step-demo-202',
        title: 'Apply Discount Coupon Code "SUMMER20"',
        feature: 'Payments',
        description: 'Enter promotional code into coupon input field and tap Apply.',
        expectedOutcome: '20% discount subtotal is calculated instantly and order total reflects discount.'
      },
      {
        id: 'step-demo-203',
        title: 'Complete Biometric Apple Pay Checkout',
        feature: 'Payments',
        description: 'Tap Apple Pay button, authenticate with Face ID / Touch ID, and await order receipt.',
        expectedOutcome: 'Payment processes without timeout and order confirmation screen displays tracking number.'
      }
    ]
  }
];

export const SAMPLE_BUG_LOGS: BugLog[] = [
  {
    id: 'bug-demo-1',
    testRunId: 'run-plan-demo-1',
    planId: 'plan-demo-1',
    stepId: 'step-demo-102',
    stepTitle: 'Tap "Sign in with Google SSO"',
    feature: 'Authentication',
    testerName: 'Alex Rivera',
    deviceName: 'iPhone 15 Pro',
    severity: 'high',
    note: 'OAuth popup sheet rendered with white blank screen for 4 seconds before loading account selector.',
    imageUrl: 'https://images.unsplash.com/photo-1616469829941-c7200edec809?w=500&auto=format&fit=crop&q=60',
    timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    formattedTime: new Date(Date.now() - 2 * 3600 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  },
  {
    id: 'bug-demo-2',
    testRunId: 'run-plan-demo-2',
    planId: 'plan-demo-2',
    stepId: 'step-demo-202',
    stepTitle: 'Apply Discount Coupon Code "SUMMER20"',
    feature: 'Payments',
    testerName: 'Jordan Chen',
    deviceName: 'Samsung Galaxy S24',
    severity: 'medium',
    note: 'Coupon code error banner overlap with coupon button on smaller viewport resolutions.',
    timestamp: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    formattedTime: new Date(Date.now() - 5 * 3600 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
];

export const SAMPLE_RUNS: TestRun[] = [
  {
    id: 'run-plan-demo-1',
    planId: 'plan-demo-1',
    planName: 'Mobile Auth & SSO Authentication Suite',
    testerName: 'Alex Rivera',
    deviceName: 'iPhone 15 Pro',
    status: 'completed',
    currentStepIndex: 4,
    results: {
      'step-demo-101': {
        stepId: 'step-demo-101',
        status: 'green',
        feature: 'Authentication',
        timestamp: new Date(Date.now() - 3 * 3600 * 1000).toISOString()
      },
      'step-demo-102': {
        stepId: 'step-demo-102',
        status: 'yellow',
        feature: 'Authentication',
        timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
      }
    },
    bugLogs: [SAMPLE_BUG_LOGS[0]],
    startedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
  },
  {
    id: 'run-plan-demo-2',
    planId: 'plan-demo-2',
    planName: 'E-Commerce Mobile Checkout & Payment Flow',
    testerName: 'Jordan Chen',
    deviceName: 'Samsung Galaxy S24',
    status: 'completed',
    currentStepIndex: 3,
    results: {
      'step-demo-201': {
        stepId: 'step-demo-201',
        status: 'green',
        feature: 'Cart',
        timestamp: new Date(Date.now() - 6 * 3600 * 1000).toISOString()
      },
      'step-demo-202': {
        stepId: 'step-demo-202',
        status: 'yellow',
        feature: 'Payments',
        timestamp: new Date(Date.now() - 5 * 3600 * 1000).toISOString()
      },
      'step-demo-203': {
        stepId: 'step-demo-203',
        status: 'green',
        feature: 'Payments',
        timestamp: new Date(Date.now() - 4 * 3600 * 1000).toISOString()
      }
    },
    bugLogs: [SAMPLE_BUG_LOGS[1]],
    startedAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString()
  }
];


