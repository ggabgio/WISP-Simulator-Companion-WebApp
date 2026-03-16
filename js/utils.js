// utils.js

export function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

export function showMessage(element, message, type) {
  if (!element) return;
  element.textContent = message;
  element.className = 'message';
  if (type === 'success') element.classList.add('success-message');
  else if (type === 'error') element.classList.add('error-message');
  else if (type === 'info') element.classList.add('info-message');
}

export function getFirebaseErrorMessage(error) {
  switch (error.code) {
    case 'auth/invalid-email': return 'Invalid email format.';
    case 'auth/user-disabled': return 'This user account has been disabled.';
    case 'auth/user-not-found': return 'No user found with this email.';
    case 'auth/wrong-password': return 'Incorrect password.';
    case 'auth/invalid-credential': return 'Invalid credentials provided.';
    case 'auth/email-already-in-use': return 'This email address is already registered.';
    case 'auth/weak-password': return 'Password is too weak (must be at least 6 characters).';
    case 'auth/network-request-failed': return 'Network error. Please check your internet connection.';
    default: return error.message || 'An unexpected error occurred. Please try again.';
  }
}
