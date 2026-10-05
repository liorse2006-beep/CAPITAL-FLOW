const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Address4, Address6 } = require('ip-address');
const uri = require('fast-uri');
const nodemailer = require('nodemailer');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

test('IP classification covers the complete IPv6 link-local and NAT64 local-use ranges', () => {
  for (const host of ['fe80::1', 'fe81::1', 'febf::1', 'fe80:0:0:1::1']) {
    assert.equal(new Address6(host).isLinkLocal(), true, host);
  }
  for (const host of ['64:ff9b:1:7f00:0:100::', '64:ff9b:1::7f00:1']) {
    assert.equal(new Address6(host).isPrivate(), true, host);
  }
  assert.equal(new Address6('2606:4700:4700::1111').isPrivate(), false);
  assert.equal(new Address4('8.8.8.8').isLinkLocal(), false);
});

test('IP subnet checks never conflate the IPv4 and IPv6 address families', () => {
  assert.equal(new Address4('8.8.8.8').isInSubnet(new Address6('::/0')), false);
  assert.equal(new Address6('::1').isInSubnet(new Address4('0.0.0.0/0')), false);
  assert.equal(new Address4('192.168.1.20').isInSubnet(new Address4('192.168.1.0/24')), true);
  assert.equal(new Address6('fe81::1').isInSubnet(new Address6('fe80::/10')), true);
});

test('URI host comparison normalizes percent-encoded case even without a scheme', () => {
  for (const value of ['//%41.com', '//%61.com', '//A.com', '//a.com']) {
    assert.equal(uri.parse(value).host, 'a.com');
    assert.equal(uri.equal(value, '//a.com'), true);
  }
  assert.equal(uri.equal('//a.com', '//b.com'), false);
  assert.equal(uri.equal('//a.com/a', '//a.com/A'), false, 'paths remain case-sensitive');
});

for (const hook of ['afterSanitizeElements', 'afterSanitizeAttributes']) {
  test(`HTML sanitization neutralizes detached event handlers in ${hook}`, () => {
    const { window } = new JSDOM('<!DOCTYPE html><body></body>');
    try {
      const purifier = createDOMPurify(window);
      const root = window.document.createElement('div');
      root.innerHTML = '<section id="wrap"><img src="x" onerror="ATTACKER()"></section><p>Market signal</p>';
      window.document.body.append(root);
      const detachedImage = root.querySelector('img');
      purifier.addHook(hook, (node) => {
        if (node.id === 'wrap') node.remove();
      });
      purifier.sanitize(root, { IN_PLACE: true });
      assert.equal(detachedImage.hasAttribute('onerror'), false);
      assert.equal(root.querySelector('p').textContent, 'Market signal');
      assert.equal(purifier.sanitize('<b>Signal</b><script>ATTACKER()</script>'), '<b>Signal</b>');
    } finally {
      window.close();
    }
  });
}

test('transactional email still builds the intended recipient and attachment without sending mail', async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const result = await transport.sendMail({
    from: '"Capital Flow" <mailer@example.test>',
    to: 'customer@example.test',
    subject: 'Password reset code: 123456',
    text: 'Your test verification code',
    attachments: [{ filename: 'backup.json.gz', content: Buffer.from('isolated-test-backup') }],
  });
  assert.deepEqual(result.envelope.to, ['customer@example.test']);
  const message = JSON.parse(result.message.toString());
  assert.equal(message.subject, 'Password reset code: 123456');
  assert.equal(message.attachments[0].filename, 'backup.json.gz');
});
