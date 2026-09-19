'use strict';
/**
 * dsh-endfield-boot — installed (bundle) HOST half.
 *
 * Pure client-side boot screen; nothing to do in the host realm. The browser
 * half (exports["./client"] -> client.js) injects the stylesheet and plays
 * the ENDFIELD boot plate on page load.
 */
const NAME = 'dsh-endfield-boot';

function apply() {
  // Pure client-side — nothing to do in the host realm.
}

module.exports = {
  name: NAME,
  apply
};
