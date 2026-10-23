import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

describe('Sign Up Profile Photo / Avatar & Live Camera Integration', () => {
  const loginHtmlPath = path.resolve('c:/Users/user/Desktop/web app1/web app/client/login.html');
  const loginHtml = fs.readFileSync(loginHtmlPath, 'utf8');

  test('1. Profile photo picker markup exists in form-signup', () => {
    assert.ok(loginHtml.includes('id="signup-avatar-box"'), 'Must include signup-avatar-box');
    assert.ok(loginHtml.includes('id="signup-avatar-initials"'), 'Must include signup-avatar-initials');
    assert.ok(loginHtml.includes('id="signup-avatar-preview"'), 'Must include signup-avatar-preview');
    assert.ok(loginHtml.includes('id="signup-photo-file-input"'), 'Must include hidden file input');
    assert.ok(loginHtml.includes('id="btn-signup-choose-file"'), 'Must include Upload button');
    assert.ok(loginHtml.includes('id="btn-signup-open-camera"'), 'Must include Take Photo button');
    assert.ok(loginHtml.includes('id="btn-signup-remove-photo"'), 'Must include Remove photo button');
    assert.ok(loginHtml.includes('id="btn-signup-avatar-cam-badge"'), 'Must include camera badge icon button');
    assert.ok(loginHtml.includes('id="signup-photo-status-badge"'), 'Must include photo added status badge');
  });

  test('2. Live webcam modal markup exists with camera controls and circular guide', () => {
    assert.ok(loginHtml.includes('id="signup-camera-modal"'), 'Must include signup-camera-modal');
    assert.ok(loginHtml.includes('id="signup-camera-video"'), 'Must include live video stream element');
    assert.ok(loginHtml.includes('id="signup-camera-canvas"'), 'Must include snapshot canvas element');
    assert.ok(loginHtml.includes('id="signup-camera-circle-guide"'), 'Must include circular guide overlay');
    assert.ok(loginHtml.includes('id="btn-snap-signup-camera"'), 'Must include snap camera button');
    assert.ok(loginHtml.includes('id="btn-flip-signup-camera"'), 'Must include flip camera button');
    assert.ok(loginHtml.includes('id="btn-retake-signup-camera"'), 'Must include retake camera button');
    assert.ok(loginHtml.includes('id="btn-accept-signup-camera"'), 'Must include accept photo button');
    assert.ok(loginHtml.includes('id="signup-camera-fallback"'), 'Must include camera fallback for denied access');
  });

  test('3. JavaScript handles initials, center-crop, auto-optimization, and storage sync', () => {
    assert.ok(loginHtml.includes('var signupPhotoDataUrl ='), 'Must have signupPhotoDataUrl state');
    assert.ok(loginHtml.includes('function getInitials(name)'), 'Must include getInitials helper');
    assert.ok(loginHtml.includes('function updateSignupAvatarDisplay()'), 'Must include avatar update logic');
    assert.ok(loginHtml.includes('function processSelectedAvatar('), 'Must include image processing and resizing');
    assert.ok(loginHtml.includes("localStorage.setItem('tfr_user_avatar'"), 'Must persist avatar to localStorage tfr_user_avatar');
    assert.ok(loginHtml.includes("tfr:avatar_updated"), 'Must dispatch tfr:avatar_updated event for reactive layout');
    assert.ok(loginHtml.includes("photoURL: signupPhotoDataUrl"), 'Must include photoURL in session and Firestore');
  });

  test('4. CSS styling includes responsive card, hover states, and dragover highlight', () => {
    assert.ok(loginHtml.includes('.signup-photo-card'), 'Must style .signup-photo-card');
    assert.ok(loginHtml.includes('.signup-avatar-box'), 'Must style .signup-avatar-box');
    assert.ok(loginHtml.includes('.signup-avatar-box.dragover'), 'Must support dragover styling');
    assert.ok(loginHtml.includes('.signup-camera-backdrop'), 'Must style camera backdrop with blur');
    assert.ok(loginHtml.includes('.signup-camera-dialog'), 'Must style camera dialog');
  });

  test('5. Appbar header and Layout component reflect uploaded photo over text initials', () => {
    const layoutJsPath = path.resolve('c:/Users/user/Desktop/web app1/web app/js/core/layout.js');
    const layoutContent = fs.readFileSync(layoutJsPath, 'utf8');

    // Verify layout.js resolves and renders uploaded photo in appbar avatar
    assert.ok(layoutContent.includes('userPhoto'), 'layout.js must check userPhoto in appbar');
    assert.ok(layoutContent.includes('avContentHtml = userPhoto ?'), 'Must construct avContentHtml with img tag');
    assert.ok(layoutContent.includes('id="btn-user-avatar"'), 'Must target btn-user-avatar in appbar');
    assert.ok(layoutContent.includes('tfr_user_avatar'), 'Must resolve photo from localStorage tfr_user_avatar');
    assert.ok(layoutContent.includes('tfr:avatar_updated'), 'Must listen to tfr:avatar_updated event in layout');

    // Verify updateUserContext does not wipe photo with initials
    assert.ok(layoutContent.includes('if (photo) {'), 'updateUserContext must branch on photo');
    assert.ok(layoutContent.includes('avatarEl.innerHTML = \'<img src="\' + photo'), 'updateUserContext must render img when photo exists');

    // Verify FirebaseBridge exports
    const firebaseJsPath = path.resolve('c:/Users/user/Desktop/web app1/web app/js/firebase.js');
    const firebaseContent = fs.readFileSync(firebaseJsPath, 'utf8');
    assert.ok(firebaseContent.includes('FirebaseBridge.updateUserPhoto'), 'Must expose updateUserPhoto');
    assert.ok(firebaseContent.includes('FirebaseBridge.getUserPhoto'), 'Must expose getUserPhoto');
  });
});

