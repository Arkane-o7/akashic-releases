import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron, expect } from '@playwright/test';
const root=path.resolve('output/startup');
const start=Date.now();
const app=await _electron.launch({executablePath:process.env.TEST_EXECUTABLE,timeout:150000});
try {
 const page=await app.firstWindow();page.setDefaultTimeout(60000);
 await expect(page.getByRole('heading',{name:'What should we call you?',exact:true})).toBeVisible({timeout:180000});
 await expect(page.getByLabel('Profile name',{exact:true})).toBeEnabled({timeout:60000});
 await page.getByLabel('Profile name',{exact:true}).fill('Startup timing test');
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Set up later',exact:true}).click();
 await expect(page.locator('.setup-journey')).toHaveCount(0,{timeout:60000});
 await expect(page.locator('[data-startup-splash]')).toHaveCount(0,{timeout:60000});
 const composer=page.locator('[data-slot="composer-rich-input"][contenteditable="true"]').first();
 await expect(composer).toBeVisible();await composer.fill('Setup verification');await expect(composer).toContainText('Setup verification');await composer.fill('');
 const bounds=await composer.boundingBox();assert(bounds);
 const ratio=await page.evaluate(()=>devicePixelRatio);
 fs.writeFileSync(path.join(root,'composer-point.json'),JSON.stringify({x:(bounds.x+bounds.width/2)*ratio,y:(bounds.y+bounds.height/2)*ratio,ratio}));
 await page.screenshot({path:path.join(root,'setup-complete.png')});
 fs.writeFileSync(path.join(root,'setup.json'),JSON.stringify({setupCompleted:true,provider:'Set up later',realModelTest:false,instrumentedSetupOnly:true,elapsedMs:Date.now()-start}));
} finally {await app.close();}
