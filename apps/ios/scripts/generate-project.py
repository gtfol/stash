#!/usr/bin/env python3
"""Regenerate the checked-in Xcode project and entitlements using only Python's standard library.

Identifiers live here. To rename the app, change its bundle ID, or build under another team, edit
the constants below, run `python3 scripts/generate-project.py` from apps/ios, and commit the result.
"""
import hashlib
import json
from pathlib import Path

DISPLAY_NAME = 'stash'
# Working identifier, not yet registered in App Store Connect. Adjust freely before release.
BUNDLE_ID = 'dev.gtfol.stash'
# Placeholder until registered under Certificates, Identifiers & Profiles > App Groups.
APP_GROUP = 'group.' + BUNDLE_ID
# gtfol, LLC, as in freewrite. Contributors can pick their own team in Xcode for device builds.
DEVELOPMENT_TEAM = 'J59ZSG67SJ'
MARKETING_VERSION = '0.1'
CURRENT_PROJECT_VERSION = '1'

root = Path(__file__).resolve().parents[1]
objects = {}


def uid(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()


def add(name, value):
    key = uid(name)
    objects[key] = value
    return key


def serialize(value, indent=0):
    if isinstance(value, dict):
        return '{\n' + ''.join('\t' * (indent + 1) + k + ' = ' + serialize(v, indent + 1) + ';\n' for k, v in value.items()) + '\t' * indent + '}'
    if isinstance(value, list):
        return '(' + ', '.join(serialize(v, indent) for v in value) + (',' if value else '') + ')'
    return json.dumps(str(value))


# MARK: Files and groups mirroring the folders

FILE_TYPES = {'.swift': 'sourcecode.swift', '.plist': 'text.plist.xml', '.entitlements': 'text.plist.entitlements',
              '.xcassets': 'folder.assetcatalog'}
refs = {}


def file_ref(rel):
    if rel not in refs:
        path = Path(rel)
        refs[rel] = add('file:' + rel, {'isa': 'PBXFileReference', 'lastKnownFileType': FILE_TYPES.get(path.suffix, 'file'),
                                        'path': path.name, 'sourceTree': '<group>'})
    return refs[rel]


def swift(folder):
    return sorted(str(p.relative_to(root)) for p in (root / folder).rglob('*.swift'))


app_sources = swift('Stash')
share_sources = swift('StashShare') + ['Stash/Core/AppConfiguration.swift', 'Stash/Core/SharedPayload.swift',
                                       'Stash/Core/ShareInbox.swift', 'Stash/Core/WebLink.swift', 'Stash/UI/Interface.swift']
test_sources = swift('StashTests')
ui_test_sources = swift('StashUITests')
app_resources = ['Stash/Assets.xcassets', 'Stash/Resources/Lato-OFL.txt', 'Stash/Resources/Lato-Regular.ttf',
                 'Stash/Resources/PrivacyInfo.xcprivacy']
share_resources = ['Stash/Resources/Lato-OFL.txt', 'Stash/Resources/Lato-Regular.ttf', 'StashShare/PrivacyInfo.xcprivacy']
listed = ['Stash/Info.plist', 'Stash/Stash.entitlements', 'StashShare/Info.plist', 'StashShare/StashShare.entitlements']

tree = {}
for rel in sorted(set(app_sources + share_sources + test_sources + ui_test_sources + app_resources + share_resources + listed)):
    node = tree
    parts = rel.split('/')
    for part in parts[:-1]:
        node = node.setdefault(part, {})
    node[parts[-1]] = rel


def make_group(name, subtree, prefix):
    children = []
    for key in sorted(subtree, key=lambda k: (isinstance(subtree[k], str), k.lower())):
        value = subtree[key]
        children.append(make_group(key, value, prefix + key + '/') if isinstance(value, dict) else file_ref(value))
    return add('group:' + prefix, {'isa': 'PBXGroup', 'children': children, 'path': name, 'sourceTree': '<group>'})


folders = [make_group(name, tree[name], name + '/') for name in ['Stash', 'StashShare', 'StashTests', 'StashUITests']]
app_product = add('product:app', {'isa': 'PBXFileReference', 'explicitFileType': 'wrapper.application', 'path': 'Stash.app', 'sourceTree': 'BUILT_PRODUCTS_DIR'})
share_product = add('product:share', {'isa': 'PBXFileReference', 'explicitFileType': 'wrapper.app-extension', 'path': 'StashShare.appex', 'sourceTree': 'BUILT_PRODUCTS_DIR'})
test_product = add('product:tests', {'isa': 'PBXFileReference', 'explicitFileType': 'wrapper.cfbundle', 'path': 'StashTests.xctest', 'sourceTree': 'BUILT_PRODUCTS_DIR'})
ui_test_product = add('product:uitests', {'isa': 'PBXFileReference', 'explicitFileType': 'wrapper.cfbundle', 'path': 'StashUITests.xctest', 'sourceTree': 'BUILT_PRODUCTS_DIR'})
products = add('products', {'isa': 'PBXGroup', 'children': [app_product, share_product, test_product, ui_test_product], 'name': 'Products', 'sourceTree': '<group>'})
main_group = add('main-group', {'isa': 'PBXGroup', 'children': folders + [products], 'sourceTree': '<group>'})


# MARK: Build phases

def phase(name, isa, files, extra=None):
    builds = [add(name + ':' + rel, {'isa': 'PBXBuildFile', 'fileRef': file_ref(rel)}) for rel in files]
    value = {'isa': isa, 'buildActionMask': '2147483647', 'files': builds, 'runOnlyForDeploymentPostprocessing': '0'}
    value.update(extra or {})
    return add(name, value)


embed_build = add('embed:share', {'isa': 'PBXBuildFile', 'fileRef': share_product, 'settings': {'ATTRIBUTES': ['RemoveHeadersOnCopy']}})
embed_extensions = add('embed-extensions', {'isa': 'PBXCopyFilesBuildPhase', 'buildActionMask': '2147483647', 'dstPath': '',
                                            'dstSubfolderSpec': '13', 'files': [embed_build], 'name': 'Embed Foundation Extensions',
                                            'runOnlyForDeploymentPostprocessing': '0'})


# MARK: Build settings

common = {
    'COPY_PHASE_STRIP': 'NO', 'LM_SKIP_METADATA_EXTRACTION': 'YES', 'CLANG_ENABLE_MODULES': 'YES', 'CLANG_ENABLE_OBJC_ARC': 'YES',
    'GCC_C_LANGUAGE_STANDARD': 'gnu17', 'CLANG_CXX_LANGUAGE_STANDARD': 'gnu++20', 'IPHONEOS_DEPLOYMENT_TARGET': '17.0',
    'SDKROOT': 'iphoneos', 'SWIFT_VERSION': '6.0', 'SWIFT_STRICT_CONCURRENCY': 'complete', 'ENABLE_USER_SCRIPT_SANDBOXING': 'YES',
    'GCC_WARN_ABOUT_RETURN_TYPE': 'YES_ERROR', 'GCC_WARN_UNINITIALIZED_AUTOS': 'YES_AGGRESSIVE', 'CLANG_WARN_DOCUMENTATION_COMMENTS': 'YES',
    'CLANG_WARN_UNREACHABLE_CODE': 'YES', 'SWIFT_TREAT_WARNINGS_AS_ERRORS': 'YES', 'TARGETED_DEVICE_FAMILY': '1',
    'SUPPORTED_PLATFORMS': 'iphoneos iphonesimulator', 'SUPPORTS_MACCATALYST': 'NO', 'SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD': 'NO',
    'SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD': 'NO', 'CODE_SIGN_STYLE': 'Automatic', 'DEVELOPMENT_TEAM': DEVELOPMENT_TEAM,
    # Shared by the app and its extension so their versions always match, as App Store requires.
    'MARKETING_VERSION': MARKETING_VERSION, 'CURRENT_PROJECT_VERSION': CURRENT_PROJECT_VERSION,
    # Read by both Info.plists; see Stash/Core/AppConfiguration.swift.
    'STASH_APP_GROUP': APP_GROUP, 'STASH_DISPLAY_NAME': DISPLAY_NAME,
}
app_settings = {
    'PRODUCT_NAME': 'Stash', 'PRODUCT_BUNDLE_IDENTIFIER': BUNDLE_ID, 'INFOPLIST_FILE': 'Stash/Info.plist', 'GENERATE_INFOPLIST_FILE': 'NO',
    'CODE_SIGN_ENTITLEMENTS': 'Stash/Stash.entitlements', 'ASSETCATALOG_COMPILER_APPICON_NAME': 'AppIcon',
    'ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME': 'AccentColor', 'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/Frameworks'],
}
share_settings = {
    'PRODUCT_NAME': 'StashShare', 'PRODUCT_BUNDLE_IDENTIFIER': BUNDLE_ID + '.share', 'INFOPLIST_FILE': 'StashShare/Info.plist',
    'GENERATE_INFOPLIST_FILE': 'NO', 'CODE_SIGN_ENTITLEMENTS': 'StashShare/StashShare.entitlements', 'APPLICATION_EXTENSION_API_ONLY': 'YES',
    'SKIP_INSTALL': 'YES', 'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks'],
}
test_settings = {
    'PRODUCT_NAME': '$(TARGET_NAME)', 'PRODUCT_BUNDLE_IDENTIFIER': BUNDLE_ID + '.tests', 'GENERATE_INFOPLIST_FILE': 'YES',
    'TEST_HOST': '$(BUILT_PRODUCTS_DIR)/Stash.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Stash', 'BUNDLE_LOADER': '$(TEST_HOST)',
    'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/Frameworks', '@loader_path/Frameworks'],
}
ui_test_settings = {
    'PRODUCT_NAME': '$(TARGET_NAME)', 'PRODUCT_BUNDLE_IDENTIFIER': BUNDLE_ID + '.uitests', 'GENERATE_INFOPLIST_FILE': 'YES',
    'TEST_TARGET_NAME': 'Stash', 'LD_RUNPATH_SEARCH_PATHS': ['$(inherited)', '@executable_path/Frameworks', '@loader_path/Frameworks'],
}


def configs(name, settings):
    refs_ = []
    for config in ['Debug', 'Release']:
        values = dict(settings)
        if name == 'project':
            values.update({'DEBUG_INFORMATION_FORMAT': 'dwarf' if config == 'Debug' else 'dwarf-with-dsym',
                           'SWIFT_OPTIMIZATION_LEVEL': '-Onone' if config == 'Debug' else '-O',
                           'ONLY_ACTIVE_ARCH': 'YES' if config == 'Debug' else 'NO',
                           'ENABLE_TESTABILITY': 'YES' if config == 'Debug' else 'NO'})
            if config == 'Debug':
                values['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = 'DEBUG $(inherited)'
            else:
                values['SWIFT_COMPILATION_MODE'] = 'wholemodule'
        refs_.append(add(name + config, {'isa': 'XCBuildConfiguration', 'buildSettings': values, 'name': config}))
    return add(name + 'configs', {'isa': 'XCConfigurationList', 'buildConfigurations': refs_, 'defaultConfigurationIsVisible': '0',
                                  'defaultConfigurationName': 'Release'})


# MARK: Targets

def target(key, name, product, product_type, settings, phases, dependencies=()):
    return add(key, {'isa': 'PBXNativeTarget', 'buildConfigurationList': configs(key, settings), 'buildPhases': phases, 'buildRules': [],
                     'dependencies': list(dependencies), 'name': name, 'productName': name, 'productReference': product,
                     'productType': product_type})


def dependency(key, target_id, name):
    proxy = add(key + '-proxy', {'isa': 'PBXContainerItemProxy', 'containerPortal': uid('project'), 'proxyType': '1',
                                 'remoteGlobalIDString': target_id, 'remoteInfo': name})
    return add(key, {'isa': 'PBXTargetDependency', 'target': target_id, 'targetProxy': proxy})


share_target = target('share-target', 'StashShare', share_product, 'com.apple.product-type.app-extension', share_settings, [
    phase('share-sources', 'PBXSourcesBuildPhase', share_sources),
    phase('share-frameworks', 'PBXFrameworksBuildPhase', []),
    phase('share-resources', 'PBXResourcesBuildPhase', share_resources),
])
app_target = target('app-target', 'Stash', app_product, 'com.apple.product-type.application', app_settings, [
    phase('app-sources', 'PBXSourcesBuildPhase', app_sources),
    phase('app-frameworks', 'PBXFrameworksBuildPhase', []),
    phase('app-resources', 'PBXResourcesBuildPhase', app_resources),
    embed_extensions,
], [dependency('app-share-dependency', share_target, 'StashShare')])
test_target = target('test-target', 'StashTests', test_product, 'com.apple.product-type.bundle.unit-test', test_settings, [
    phase('test-sources', 'PBXSourcesBuildPhase', test_sources),
    phase('test-frameworks', 'PBXFrameworksBuildPhase', []),
], [dependency('test-dependency', app_target, 'Stash')])
ui_test_target = target('ui-test-target', 'StashUITests', ui_test_product, 'com.apple.product-type.bundle.ui-testing', ui_test_settings, [
    phase('ui-test-sources', 'PBXSourcesBuildPhase', ui_test_sources),
    phase('ui-test-frameworks', 'PBXFrameworksBuildPhase', []),
], [dependency('ui-test-dependency', app_target, 'Stash')])

created = {'CreatedOnToolsVersion': '26.6'}
project = add('project', {
    'isa': 'PBXProject',
    'attributes': {'BuildIndependentTargetsInParallel': 'YES', 'LastUpgradeCheck': '2660', 'LastSwiftUpdateCheck': '2660',
                   'TargetAttributes': {app_target: created, share_target: created,
                                        test_target: dict(created, TestTargetID=app_target),
                                        ui_test_target: dict(created, TestTargetID=app_target)}},
    'buildConfigurationList': configs('project', common), 'compatibilityVersion': 'Xcode 14.0', 'developmentRegion': 'en',
    'hasScannedForEncodings': '0', 'knownRegions': ['en', 'Base'], 'mainGroup': main_group, 'productRefGroup': products,
    'projectDirPath': '', 'projectRoot': '', 'targets': [app_target, share_target, test_target, ui_test_target],
})

output = '// !$*UTF8*$!\n' + serialize({'archiveVersion': '1', 'classes': {}, 'objectVersion': '56', 'objects': objects, 'rootObject': project}) + '\n'
(root / 'Stash.xcodeproj').mkdir(exist_ok=True)
(root / 'Stash.xcodeproj/project.pbxproj').write_text(output)


# MARK: Scheme

def reference(identifier, name, product):
    return (f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{identifier}" '
            f'BuildableName="{product}" BlueprintName="{name}" ReferencedContainer="container:Stash.xcodeproj"/>')


app_ref = reference(app_target, 'Stash', 'Stash.app')
test_ref = reference(test_target, 'StashTests', 'StashTests.xctest')
ui_test_ref = reference(ui_test_target, 'StashUITests', 'StashUITests.xctest')
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2660" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
    <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{app_ref}</BuildActionEntry>
  </BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables>
    <TestableReference skipped="NO" parallelizable="NO">{test_ref}</TestableReference>
    <TestableReference skipped="NO" parallelizable="NO">{ui_test_ref}</TestableReference>
  </Testables></TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{app_ref}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{app_ref}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
'''
(root / 'Stash.xcodeproj/xcshareddata/xcschemes').mkdir(parents=True, exist_ok=True)
(root / 'Stash.xcodeproj/xcshareddata/xcschemes/Stash.xcscheme').write_text(scheme)


# MARK: Entitlements: the same App Group for the app and its share extension

entitlements = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>{APP_GROUP}</string>
	</array>
</dict>
</plist>
'''
(root / 'Stash/Stash.entitlements').write_text(entitlements)
(root / 'StashShare/StashShare.entitlements').write_text(entitlements)
