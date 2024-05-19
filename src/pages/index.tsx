import { useCurrentUser } from '@/hooks/auth';
import { getTerms } from '@/utils/browseTerms';
import { showSettings } from '@/utils/settings';
import { genericToastOptions } from '@/utils/toastOptions';
import { withAuth } from '@/utils/withAuth';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';

const BOOKMARKLET =
	"javascript:(function()%7B(function%20()%20%7B%0A%09%22use%20strict%22%3B%0A%09const%20DMM_HOST%20%3D%20%22https%3A%2F%2Fdebridmediamanager.com%22%3B%0A%09const%20X_DMM_HOST%20%3D%20%22https%3A%2F%2Fx.debridmediamanager.com%22%3B%0A%09const%20SEARCH_BTN_LABEL%20%3D%20%22DMM%F0%9F%94%8E%22%3B%0A%0A%09function%20createButton(text%2C%20url)%20%7B%0A%09%09const%20button%20%3D%20document.createElement(%22button%22)%3B%0A%09%09%2F%2F%20button.tabIndex%20%3D%200%3B%0A%09%09%2F%2F%20button.disabled%20%3D%20false%3B%0A%09%09button.textContent%20%3D%20text%3B%0A%09%09button.style.fontFamily%20%3D%20%22'Roboto'%2C%20sans-serif%22%3B%0A%09%09button.style.marginLeft%20%3D%20%225px%22%3B%0A%09%09button.style.padding%20%3D%20%223px%205px%22%3B%0A%09%09button.style.border%20%3D%20%22none%22%3B%0A%09%09button.style.borderRadius%20%3D%20%223px%22%3B%0A%09%09button.style.background%20%3D%20%22%2300A0B0%22%3B%20%2F%2F%20Teal%20color%0A%09%09button.style.color%20%3D%20%22%23ECF0F1%22%3B%20%2F%2F%20Off-white%20color%0A%09%09button.style.cursor%20%3D%20%22pointer%22%3B%0A%09%09button.style.transition%20%3D%20%22background-color%200.3s%2C%20transform%200.1s%22%3B%0A%0A%09%09%2F%2F%20Hover%20effect%0A%09%09button.onmouseover%20%3D%20function%20()%20%7B%0A%09%09%09this.style.background%20%3D%20%22%23EDC951%22%3B%20%2F%2F%20Yellow%20color%0A%09%09%7D%3B%0A%0A%09%09%2F%2F%20Revert%20hover%20effect%0A%09%09button.onmouseout%20%3D%20function%20()%20%7B%0A%09%09%09this.style.background%20%3D%20%22%2300A0B0%22%3B%20%2F%2F%20Teal%20color%0A%09%09%7D%3B%0A%0A%09%09%2F%2F%20Click%20effect%0A%09%09button.onmousedown%20%3D%20function%20()%20%7B%0A%09%09%09this.style.transform%20%3D%20%22scale(0.95)%22%3B%0A%09%09%09this.style.background%20%3D%20%22%23CC333F%22%3B%20%2F%2F%20Dark%20red%20color%0A%09%09%7D%3B%0A%0A%09%09%2F%2F%20Revert%20click%20effect%0A%09%09button.onmouseup%20%3D%20function%20()%20%7B%0A%09%09%09this.style.transform%20%3D%20%22scale(1)%22%3B%0A%09%09%09this.style.background%20%3D%20%22%23EDC951%22%3B%20%2F%2F%20Yellow%20color%20(same%20as%20hover%20effect)%0A%09%09%7D%3B%0A%0A%09%09%2F%2F%20Open%20new%20tab%20on%20click%0A%09%09button.onclick%20%3D%20(event)%20%3D%3E%20%7B%0A%09%09%09event.preventDefault()%3B%0A%09%09%09window.open(url%2C%20%22_blank%22)%3B%0A%09%09%7D%3B%0A%0A%09%09return%20button%3B%0A%09%7D%0A%0A%09function%20createLink(text%2C%20url)%20%7B%0A%09%09const%20link%20%3D%20document.createElement(%22a%22)%3B%0A%09%09link.textContent%20%3D%20text%3B%0A%09%09link.href%20%3D%20url%3B%0A%09%09link.target%20%3D%20%22_blank%22%3B%20%2F%2F%20Opens%20the%20link%20in%20a%20new%20tab%0A%09%09link.style.display%20%3D%20%22inline-block%22%3B%20%2F%2F%20Display%20as%20inline-block%20to%20style%20like%20a%20button%0A%09%09link.style.fontFamily%20%3D%20%22'Roboto'%2C%20sans-serif%22%3B%0A%09%09link.style.marginLeft%20%3D%20%225px%22%3B%0A%09%09link.style.padding%20%3D%20%223px%205px%22%3B%0A%09%09link.style.border%20%3D%20%22none%22%3B%0A%09%09link.style.borderRadius%20%3D%20%223px%22%3B%0A%09%09link.style.background%20%3D%20%22%2300A0B0%22%3B%20%2F%2F%20Teal%20color%0A%09%09link.style.color%20%3D%20%22%23ECF0F1%22%3B%20%2F%2F%20Off-white%20color%0A%09%09link.style.textDecoration%20%3D%20%22none%22%3B%20%2F%2F%20Remove%20underline%20from%20the%20link%0A%09%09link.style.cursor%20%3D%20%22pointer%22%3B%0A%0A%09%09return%20link%3B%0A%09%7D%0A%0A%09function%20addButtonToElement(element%2C%20text%2C%20url)%20%7B%0A%09%09const%20button%20%3D%20createButton(text%2C%20url)%3B%0A%09%09element.appendChild(button)%3B%0A%09%7D%0A%0A%09function%20addLinkToElement(element%2C%20text%2C%20url)%20%7B%0A%09%09const%20button%20%3D%20createLink(text%2C%20url)%3B%0A%09%09element.appendChild(button)%3B%0A%09%7D%0A%0A%09%2F%2F%20IMDB%20functions%0A%09function%20addButtonsToIMDBSingleTitle()%20%7B%0A%09%09const%20targetElement%20%3D%20document.querySelector(%0A%09%09%09%22section.ipc-page-background%20h1%20%3E%20span%22%0A%09%09)%3B%0A%0A%09%09if%20(targetElement%20%26%26%20targetElement.hasAttribute(%22data-dmm-btn-added%22))%0A%09%09%09return%3B%0A%09%09targetElement.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09const%20searchUrl%20%3D%20%60%24%7BX_DMM_HOST%7D%2F%24%7Bwindow.location.pathname%0A%09%09%09.replaceAll(%22%2F%22%2C%20%22%22)%0A%09%09%09.substring(5)%7D%60%3B%0A%09%09addButtonToElement(targetElement%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%7D%0A%0A%09function%20addButtonsToIMDBList()%20%7B%0A%09%09const%20items%20%3D%20Array.from(%0A%09%09%09document.querySelectorAll(%0A%09%09%09%09%22.lister-item%20.lister-item-header%2C%20.lister-item%20.media%22%0A%09%09%09)%0A%09%09).filter((item)%20%3D%3E%20!item.hasAttribute(%22data-dmm-btn-added%22))%3B%0A%0A%09%09items.forEach((item)%20%3D%3E%20%7B%0A%09%09%09item.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09%09let%20link%20%3D%20item.querySelector('a%5Bhref%5E%3D%22%2Ftitle%2F%22%5D').href%3B%0A%09%09%09let%20imdbId%20%3D%20link.match(%2Ftt%5Cd%2B%2F)%3F.%5B0%5D%3B%0A%09%09%09if%20(!imdbId)%20return%3B%0A%09%09%09const%20searchUrl%20%3D%20%60%24%7BX_DMM_HOST%7D%2F%24%7BimdbId%7D%60%3B%0A%0A%09%09%09addButtonToElement(item%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%09%7D)%3B%0A%0A%09%09changeObserver(%22ul.ipc-metadata-list%22%2C%20addButtonsToIMDBList)%3B%0A%09%7D%0A%0A%09function%20addButtonsToIMDBChart()%20%7B%0A%09%09const%20items%20%3D%20Array.from(document.querySelectorAll(%22.cli-title%22)).filter(%0A%09%09%09(item)%20%3D%3E%0A%09%09%09%09item.innerText.match(%2F%5Cd%2B%5C.%2F)%20%26%26%0A%09%09%09%09!item.hasAttribute(%22data-dmm-btn-added%22)%0A%09%09)%3B%0A%0A%09%09items.forEach((item)%20%3D%3E%20%7B%0A%09%09%09item.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09%09let%20link%20%3D%20item.querySelector('a%5Bhref%5E%3D%22%2Ftitle%2F%22%5D').href%3B%0A%09%09%09let%20imdbId%20%3D%20link.match(%2Ftt%5Cd%2B%2F)%3F.%5B0%5D%3B%0A%09%09%09if%20(!imdbId)%20return%3B%0A%09%09%09const%20searchUrl%20%3D%20%60%24%7BX_DMM_HOST%7D%2F%24%7BimdbId%7D%60%3B%0A%0A%09%09%09addButtonToElement(item%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%09%7D)%3B%0A%0A%09%09changeObserver(%22ul.ipc-metadata-list%22%2C%20addButtonsToIMDBChart)%3B%0A%09%7D%0A%0A%09%2F%2F%20MDBList%20functions%0A%09function%20addButtonsToMDBListSingleTitle()%20%7B%0A%09%09const%20targetElement%20%3D%20document.querySelector(%0A%09%09%09%22%23content-desktop-2%20%3E%20div%20%3E%20div%3Anth-child(1)%20%3E%20h3%22%0A%09%09)%3B%0A%0A%09%09if%20(targetElement%20%26%26%20targetElement.hasAttribute(%22data-dmm-btn-added%22))%0A%09%09%09return%3B%0A%09%09targetElement.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09const%20searchUrl%20%3D%20%60%24%7BDMM_HOST%7D%24%7Bwindow.location.pathname%7D%60%3B%0A%09%09addButtonToElement(targetElement%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%7D%0A%0A%09function%20addButtonsToMDBListSearchResults()%20%7B%0A%09%09const%20items%20%3D%20Array.from(%0A%09%09%09document.querySelectorAll(%22div.ui.centered.cards%20%3E%20div%22)%0A%09%09).filter((item)%20%3D%3E%20!item.hasAttribute(%22data-dmm-btn-added%22))%3B%0A%0A%09%09items.forEach((item)%20%3D%3E%20%7B%0A%09%09%09item.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09%09const%20targetElement%20%3D%20item.querySelector(%22div.header%22)%3B%0A%09%09%09if%20(targetElement)%20%7B%0A%09%09%09%09const%20url%20%3D%20targetElement.parentElement%0A%09%09%09%09%09.querySelector(%22a%22)%0A%09%09%09%09%09.href.replace(%22https%3A%2F%2Fmdblist.com%2F%22%2C%20%22%22)%3B%0A%09%09%09%09const%20searchUrl%20%3D%20%60%24%7BDMM_HOST%7D%2F%24%7Burl%7D%60%3B%0A%09%09%09%09addButtonToElement(targetElement%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%09%09%7D%0A%09%09%7D)%3B%0A%0A%09%09changeObserver(%22div.ui.centered.cards%22%2C%20addButtonsToMDBListSearchResults)%3B%0A%09%7D%0A%0A%09%2F%2F%20AniDB%20functions%0A%09function%20addButtonsToAniDBSingleTitle()%20%7B%0A%09%09const%20targetElement%20%3D%20document.querySelector(%22%23layout-main%20%3E%20h1.anime%22)%3B%0A%0A%09%09if%20(targetElement%20%26%26%20targetElement.hasAttribute(%22data-dmm-btn-added%22))%0A%09%09%09return%3B%0A%09%09targetElement.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09const%20searchUrl%20%3D%20%60%24%7BDMM_HOST%7D%2F%24%7Bwindow.location.pathname%0A%09%09%09.replaceAll(%22%2F%22%2C%20%22%22)%0A%09%09%09.replace(%22anime%22%2C%20%22anime%2Fanidb-%22)%7D%60%3B%0A%09%09addButtonToElement(targetElement%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%7D%0A%0A%09function%20addButtonsToAniDBAnyPage()%20%7B%0A%09%09const%20items%20%3D%20Array.from(document.querySelectorAll(%22a%22)).filter(%0A%09%09%09(item)%20%3D%3E%20item.innerText.trim()%20%26%26%20%2F%5C%2Fanime%5C%2F%5Cd%2B%24%2F.test(item.href)%20%26%26%20!item.hasAttribute(%22data-dmm-btn-added%22)%0A%09%09)%3B%0A%0A%09%09items.forEach((item)%20%3D%3E%20%7B%0A%09%09%09item.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09%09const%20searchUrl%20%3D%20%60%24%7BDMM_HOST%7D%2F%24%7Bitem.href%0A%09%09%09%09.replace(%22https%3A%2F%2Fanidb.net%2F%22%2C%20%22%22)%0A%09%09%09%09.replaceAll(%22%2F%22%2C%20%22%22)%0A%09%09%09%09.replace(%22anime%22%2C%20%22anime%2Fanidb-%22)%7D%60%3B%0A%0A%09%09%09addButtonToElement(item%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%09%7D)%3B%0A%09%7D%0A%0A%09%2F%2F%20TraktTV%20functions%0A%09function%20addButtonsToTraktTVSingleTitle()%20%7B%0A%09%09const%20targetElement%20%3D%20document.querySelector(%22%23summary-wrapper%20div%20%3E%20h1%22)%3B%0A%0A%09%09if%20(targetElement%20%26%26%20targetElement.hasAttribute(%22data-dmm-btn-added%22))%0A%09%09%09return%3B%0A%09%09%2F%2F%20find%20imdb%20id%20in%20page%2C%20%3Ca%20data-type%3D%22imdb%22%3E%0A%09%09const%20imdbId%20%3D%20document%0A%09%09%09.querySelector(%22a%23external-link-imdb%22)%0A%09%09%09%3F.href%3F.match(%2Ftt%5Cd%2B%2F)%3F.%5B0%5D%3B%0A%09%09if%20(!imdbId)%20return%3B%0A%0A%09%09targetElement.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09const%20searchUrl%20%3D%20%60%24%7BX_DMM_HOST%7D%2F%24%7BimdbId%7D%60%3B%0A%09%09addButtonToElement(targetElement%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%7D%0A%0A%09%2F%2F%20iCheckMovies%20functions%0A%09function%20addButtonsToiCheckMoviesSingleTitle()%20%7B%0A%09%09const%20imdbId%20%3D%20document%0A%09%09%09.querySelector(%22a.optionIMDB%22)%0A%09%09%09%3F.href%3F.match(%2Ftt%5Cd%2B%2F)%3F.%5B0%5D%3B%0A%09%09if%20(!imdbId)%20return%3B%0A%0A%09%09const%20targetElement%20%3D%20document.querySelector(%22%23movie%20%3E%20h1%22)%3B%0A%0A%09%09if%20(targetElement%20%26%26%20targetElement.hasAttribute(%22data-dmm-btn-added%22))%0A%09%09%09return%3B%0A%09%09targetElement.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09const%20searchUrl%20%3D%20%60%24%7BX_DMM_HOST%7D%2F%24%7BimdbId%7D%60%3B%0A%09%09addButtonToElement(targetElement%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%7D%0A%0A%09function%20addButtonsToiCheckMoviesBetaSingleTitle()%20%7B%0A%09%09const%20imdbId%20%3D%20document%0A%09%09%09.querySelector(%22a.stat-imdb%22)%0A%09%09%09%3F.href%3F.match(%2Ftt%5Cd%2B%2F)%3F.%5B0%5D%3B%0A%09%09if%20(!imdbId)%20return%3B%0A%0A%09%09const%20targetElement%20%3D%20document.querySelector(%22h1.title%22)%3B%0A%0A%09%09if%20(targetElement%20%26%26%20targetElement.hasAttribute(%22data-dmm-btn-added%22))%0A%09%09%09return%3B%0A%09%09targetElement.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09const%20searchUrl%20%3D%20%60%24%7BX_DMM_HOST%7D%2F%24%7BimdbId%7D%60%3B%0A%09%09addLinkToElement(targetElement%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%7D%0A%0A%09function%20addButtonsToiCheckMoviesList()%20%7B%0A%09%09const%20items%20%3D%20Array.from(%0A%09%09%09document.querySelectorAll(%22ol%23itemListMovies%20%3E%20li%22)%0A%09%09).filter((item)%20%3D%3E%20!item.hasAttribute(%22data-dmm-btn-added%22))%3B%0A%0A%09%09items.forEach((item)%20%3D%3E%20%7B%0A%09%09%09const%20imdbId%20%3D%20item%0A%09%09%09%09.querySelector(%22a.optionIMDB%22)%0A%09%09%09%09%3F.href%3F.match(%2Ftt%5Cd%2B%2F)%3F.%5B0%5D%3B%0A%09%09%09if%20(!imdbId)%20return%3B%0A%0A%09%09%09const%20targetElement%20%3D%20item.querySelector(%22h2%20a%22)%3B%0A%09%09%09if%20(!targetElement)%20return%3B%0A%0A%09%09%09item.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09%09const%20searchUrl%20%3D%20%60%24%7BX_DMM_HOST%7D%2F%24%7BimdbId%7D%60%3B%0A%09%09%09addButtonToElement(targetElement%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%09%7D)%3B%0A%09%7D%0A%0A%09function%20addButtonsToiCheckMoviesBetaList()%20%7B%0A%09%09const%20items%20%3D%20Array.from(%0A%09%09%09document.querySelectorAll(%22div.media-content%22)%0A%09%09).filter((item)%20%3D%3E%20!item.hasAttribute(%22data-dmm-btn-added%22))%3B%0A%0A%09%09items.forEach((item)%20%3D%3E%20%7B%0A%09%09%09const%20imdbId%20%3D%20item%0A%09%09%09%09.querySelector(%22a.stat-imdb%22)%0A%09%09%09%09%3F.href%3F.match(%2Ftt%5Cd%2B%2F)%3F.%5B0%5D%3B%0A%09%09%09if%20(!imdbId)%20return%3B%0A%0A%09%09%09const%20targetElement%20%3D%20item.querySelector(%22h3.title%22)%3B%0A%09%09%09if%20(!targetElement)%20return%3B%0A%0A%09%09%09item.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09%09const%20searchUrl%20%3D%20%60%24%7BX_DMM_HOST%7D%2F%24%7BimdbId%7D%60%3B%0A%09%09%09addButtonToElement(targetElement%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%09%7D)%3B%0A%0A%09%09changeObserver(%0A%09%09%09%22%23app%20section.section%20div.columns%22%2C%0A%09%09%09addButtonsToiCheckMoviesBetaList%0A%09%09)%3B%0A%09%7D%0A%0A%09%2F%2F%20letterboxd%20functions%0A%09function%20addButtonsToLetterboxdSingleTitle()%20%7B%0A%09%09const%20imdbId%20%3D%20document%0A%09%09%09.querySelector(%22a%5Bdata-track-action%3D'IMDb'%5D%22)%0A%09%09%09%3F.href%3F.match(%2Ftt%5Cd%2B%2F)%3F.%5B0%5D%3B%0A%09%09if%20(!imdbId)%20return%3B%0A%0A%09%09const%20targetElement%20%3D%20document.querySelector(%22h1.filmtitle%22)%3B%0A%0A%09%09if%20(targetElement%20%26%26%20targetElement.hasAttribute(%22data-dmm-btn-added%22))%0A%09%09%09return%3B%0A%09%09targetElement.setAttribute(%22data-dmm-btn-added%22%2C%20%22true%22)%3B%0A%0A%09%09const%20searchUrl%20%3D%20%60%24%7BX_DMM_HOST%7D%2F%24%7BimdbId%7D%60%3B%0A%09%09addButtonToElement(targetElement%2C%20SEARCH_BTN_LABEL%2C%20searchUrl)%3B%0A%09%7D%0A%0A%09%2F%2F%20observer%20utility%20function%0A%09function%20changeObserver(cssSelector%2C%20addBtnFn)%20%7B%0A%09%09const%20targetNode%20%3D%20document.querySelector(cssSelector)%3B%0A%09%09if%20(!targetNode)%20return%3B%0A%09%09const%20config%20%3D%20%7B%20childList%3A%20true%2C%20subtree%3A%20true%20%7D%3B%0A%09%09let%20debounceTimer%3B%0A%09%09const%20callback%20%3D%20function%20(mutationsList%2C%20observer)%20%7B%0A%09%09%09if%20(debounceTimer)%20%7B%0A%09%09%09%09clearTimeout(debounceTimer)%3B%0A%09%09%09%7D%0A%09%09%09debounceTimer%20%3D%20setTimeout(()%20%3D%3E%20%7B%0A%09%09%09%09%2F%2F%20if%20(!targetNode)%20return%3B%0A%09%09%09%09observer.disconnect()%3B%0A%09%09%09%09addBtnFn()%3B%0A%09%09%09%09observer.observe(targetNode%2C%20config)%3B%0A%09%09%09%7D%2C%20250)%3B%0A%09%09%7D%3B%0A%09%09const%20observer%20%3D%20new%20MutationObserver(callback)%3B%0A%09%09observer.observe(targetNode%2C%20config)%3B%0A%09%7D%0A%0A%09%2F%2F%20Main%20function%0A%0A%09const%20hostname%20%3D%20window.location.hostname%3B%0A%0A%09%2F%2F%2F%2F%2F%20IMDB%20%2F%2F%2F%2F%2F%0A%09if%20(hostname%20%3D%3D%3D%20%22www.imdb.com%22)%20%7B%0A%09%09const%20isIMDBSingleTitlePage%20%3D%20%2F%5E%5C%2Ftitle%5C%2F%2F.test(location.pathname)%3B%0A%09%09const%20isIMDBListPage%20%3D%0A%09%09%09%2F%5E%5C%2Fsearch%5C%2F%2F.test(location.pathname)%20%7C%7C%0A%09%09%09%2F%5E%5C%2Flist%5C%2Fls%2F.test(location.pathname)%3B%0A%09%09const%20isIMDBChartPage%20%3D%20%2F%5E%5C%2Fchart%5C%2F%2F.test(location.pathname)%3B%0A%0A%09%09if%20(isIMDBSingleTitlePage)%20%7B%0A%09%09%09addButtonsToIMDBSingleTitle()%3B%0A%09%09%7D%20else%20if%20(isIMDBListPage)%20%7B%0A%09%09%09addButtonsToIMDBList()%3B%0A%09%09%7D%20else%20if%20(isIMDBChartPage)%20%7B%0A%09%09%09addButtonsToIMDBChart()%3B%0A%09%09%7D%0A%0A%09%09%2F%2F%2F%2F%2F%20IMDB%20MOBILE%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22m.imdb.com%22)%20%7B%0A%09%09const%20isIMDBSingleTitlePage%20%3D%20%2F%5E%5C%2Ftitle%5C%2F%2F.test(location.pathname)%3B%0A%09%09const%20isIMDBListPage%20%3D%0A%09%09%09%2F%5E%5C%2Fsearch%5C%2F%2F.test(location.pathname)%20%7C%7C%0A%09%09%09%2F%5E%5C%2Flist%5C%2Fls%2F.test(location.pathname)%3B%0A%09%09const%20isIMDBChartPage%20%3D%20%2F%5E%5C%2Fchart%5C%2F%2F.test(location.pathname)%3B%0A%0A%09%09if%20(isIMDBSingleTitlePage)%20%7B%0A%09%09%09addButtonsToIMDBSingleTitle()%3B%0A%09%09%7D%20else%20if%20(isIMDBListPage)%20%7B%0A%09%09%09addButtonsToIMDBList()%3B%0A%09%09%7D%20else%20if%20(isIMDBChartPage)%20%7B%0A%09%09%09addButtonsToIMDBChart()%3B%0A%09%09%7D%0A%0A%09%09%2F%2F%2F%2F%2F%20MDBLIST%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22mdblist.com%22)%20%7B%0A%09%09const%20isMDBListSingleTitlePage%20%3D%20%2F%5E%5C%2F(movie%7Cshow)%5C%2F%2F.test(%0A%09%09%09location.pathname%0A%09%09)%3B%0A%0A%09%09if%20(isMDBListSingleTitlePage)%20%7B%0A%09%09%09addButtonsToMDBListSingleTitle()%3B%0A%09%09%7D%20else%20%7B%0A%09%09%09addButtonsToMDBListSearchResults()%3B%0A%09%09%7D%0A%0A%09%09%2F%2F%2F%2F%2F%20ANIDB%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22anidb.net%22)%20%7B%0A%09%09const%20isAniDBSingleTitlePage%20%3D%20%2F%5E%5C%2Fanime%5C%2F%5Cd%2B%2F.test(location.pathname)%3B%0A%0A%09%09if%20(isAniDBSingleTitlePage)%20%7B%0A%09%09%09addButtonsToAniDBSingleTitle()%3B%0A%09%09%7D%0A%09%09addButtonsToAniDBAnyPage()%3B%0A%0A%09%09%2F%2F%2F%2F%2F%20TRAKT%20TV%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22trakt.tv%22)%20%7B%0A%09%09const%20isTraktTVEpisodePage%20%3D%20%2F%5C%2Fepisodes%5C%2F%5Cd%2F.test(location.pathname)%3B%0A%09%09if%20(isTraktTVEpisodePage)%20return%3B%0A%0A%09%09const%20isTraktTVSinglePage%20%3D%20%2F%5E%5C%2F(shows%7Cmovies)%5C%2F.%2B%2F.test(location.pathname)%3B%0A%0A%09%09if%20(isTraktTVSinglePage)%20%7B%0A%09%09%09addButtonsToTraktTVSingleTitle()%3B%0A%09%09%7D%0A%0A%09%09%2F%2F%2F%2F%2F%20ICHECKMOVIES%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22www.icheckmovies.com%22)%20%7B%0A%09%09const%20isiCheckMoviesListPage%20%3D%20%2F%5E%5C%2Flists%5C%2F%2F.test(location.pathname)%3B%0A%09%09if%20(isiCheckMoviesListPage)%20%7B%0A%09%09%09addButtonsToiCheckMoviesList()%3B%0A%09%09%7D%0A%09%09const%20isiCheckMoviesSingleTitlePage%20%3D%20%2F%5E%5C%2Fmovies%5C%2F%2F.test(location.pathname)%3B%0A%09%09if%20(isiCheckMoviesSingleTitlePage)%20%7B%0A%09%09%09addButtonsToiCheckMoviesSingleTitle()%3B%0A%09%09%7D%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22beta.icheckmovies.com%22)%20%7B%0A%09%09const%20isiCheckMoviesListPage%20%3D%20%2F%5E%5C%2Flists%5C%2F%2F.test(location.pathname)%3B%0A%09%09if%20(isiCheckMoviesListPage)%20%7B%0A%09%09%09addButtonsToiCheckMoviesBetaList()%3B%0A%09%09%7D%0A%09%09const%20isiCheckMoviesSingleTitlePage%20%3D%20%2F%5E%5C%2Fmovies%5C%2F%2F.test(location.pathname)%3B%0A%09%09if%20(isiCheckMoviesSingleTitlePage)%20%7B%0A%09%09%09addButtonsToiCheckMoviesBetaSingleTitle()%3B%0A%09%09%7D%0A%0A%09%09%2F%2F%2F%2F%2F%20MYANIMELIST%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22myanimelist.net%22)%20%7B%0A%09%09%2F%2F%2F%2F%2F%20KITSU%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22kitsu.io%22)%20%7B%0A%0A%09%09%2F%2F%2F%2F%2F%20LETTERBOXD%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22letterboxd.com%22)%20%7B%0A%09%09const%20isLetterboxdSingleTitlePage%20%3D%20%2F%5E%5C%2Ffilm%5C%2F%2F.test(location.pathname)%3B%0A%09%09if%20(isLetterboxdSingleTitlePage)%20%7B%0A%09%09%09addButtonsToLetterboxdSingleTitle()%3B%0A%09%09%7D%0A%0A%09%09%2F%2F%2F%2F%2F%20JUSTWATCH%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22www.justwatch.com%22)%20%7B%0A%09%09%2F%2F%2F%2F%2F%20TVDB%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22www.thetvdb.com%22)%20%7B%0A%09%09%2F%2F%2F%2F%2F%20TMDB%20%2F%2F%2F%2F%2F%0A%09%7D%20else%20if%20(hostname%20%3D%3D%3D%20%22www.themoviedb.org%22)%20%7B%0A%09%7D%0A%7D)()%3B%7D)()%3B";

function IndexPage() {
	const router = useRouter();
	const { rdUser, adUser, rdError, adError, traktUser, traktError } = useCurrentUser();
	const [deleting, setDeleting] = useState(false);
	const [browseTerms] = useState(getTerms(2));
	const [showBookmarkletInfo, setShowBookmarkletInfo] = useState(false);

	useEffect(() => {
		if (rdError) {
			toast.error(
				'Real-Debrid get user info failed, try clearing DMM site data and login again'
			);
		}
		if (adError) {
			toast.error(
				'AllDebrid get user info failed, check your email and confirm the login coming from DMM'
			);
		}
		if (traktError) {
			toast.error('Trakt get user info failed');
		}
		if (localStorage.getItem('next_action') === 'clear_cache') {
			setDeleting(true);
			localStorage.removeItem('next_action');
			const request = window.indexedDB.deleteDatabase('DMMDB');
			setDeleting(true);
			request.onsuccess = function () {
				window.location.assign('/');
			};
			request.onerror = function () {
				setDeleting(false);
				toast.error('Database deletion failed', genericToastOptions);
			};
			request.onblocked = function () {
				setDeleting(false);
				toast(
					'Database is still open, refresh the page first and then try deleting again',
					genericToastOptions
				);
			};
		}
	}, [rdError, adError, traktError]);

	const handleLogout = (prefix?: string) => {
		if (prefix) {
			let i = localStorage.length - 1;
			while (i >= 0) {
				const key = localStorage.key(i);
				if (key && key.startsWith(prefix)) localStorage.removeItem(key);
				i--;
			}
			router.reload();
		} else {
			localStorage.clear();
			router.push('/start');
		}
	};

	const handleTraktLogin = async () => {
		// generate authorization url
		const authUrl = `/api/trakt/auth?redirect=${window.location.origin}`;
		router.push(authUrl);
	};

	const handleClearCache = async () => {
		localStorage.setItem('next_action', 'clear_cache');
		window.location.assign('/');
	};

	return (
		<div className="flex flex-col items-center justify-center min-h-screen">
			<Head>
				<title>Debrid Media Manager - Home</title>
			</Head>
			<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 200 200">
				<rect x="25" y="25" width="150" height="150" fill="#2C3E50" rx="20" ry="20" />
				<circle cx="100" cy="100" r="60" fill="#00A0B0" />
				<path d="M85,65 L85,135 L135,100 Z" fill="#ECF0F1" />
				<path d="M60,90 Q80,60 100,90 T140,90" fill="#CC333F" />
				<path
					d="M75,121 L80,151 L90,136 L100,151 L110,136 L120,151 L125,121 Z"
					fill="#EDC951"
				/>
			</svg>
			<Toaster position="bottom-right" />
			{/* this is made by ChatGPT */}
			{!deleting && (rdUser || adUser) ? (
				<>
					<h1 className="text-2xl font-bold mb-4">Debrid Media Manager</h1>
					<div className="flex flex-col items-center max-w-2xl">
						<div className="text-md font-bold mb-4 w-screen text-center">
							{rdUser ? (
								<>
									<span className="bg-[#b5d496] text-green-800 text-sm px-1">
										Real-Debrid
									</span>{' '}
									{rdUser.username} {rdUser.premium ? '✅' : '❌'}
								</>
							) : (
								<Link
									href="/realdebrid/login"
									className="px-1 py-1 ml-2 text-xs text-white bg-gray-500 rounded hover:bg-gray-600 whitespace-nowrap"
								>
									Login with Real-Debrid
								</Link>
							)}{' '}
							{adUser ? (
								<>
									<span className="bg-[#fbc730] text-yellow-800 text-sm px-1">
										AllDebrid
									</span>{' '}
									{adUser.username} {adUser.isPremium ? '✅' : '❌'}
								</>
							) : (
								<Link
									href="/alldebrid/login"
									className="px-1 py-1 ml-2 text-xs text-white bg-gray-500 rounded hover:bg-gray-600 whitespace-nowrap"
								>
									Login with AllDebrid
								</Link>
							)}{' '}
							{traktUser ? (
								<>
									<span className="bg-[#ed161f] text-white text-sm px-1">
										Trakt
									</span>{' '}
									{traktUser.user.username}{' '}
									<span className="text-green-500">✅</span>
								</>
							) : (
								<button
									onClick={() => handleTraktLogin()}
									className="px-1 py-1 ml-2 text-xs text-white bg-red-500 rounded hover:bg-red-600 whitespace-nowrap"
								>
									Login with Trakt
								</button>
							)}
						</div>

						<div className="mb-2 h-max text-center leading-10">
							<Link
								href="/library"
								className="text-md m-1 bg-cyan-800 hover:bg-cyan-700 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
							>
								📚 Library
							</Link>

							<Link
								href="https://hashlists.debridmediamanager.com"
								target="_blank"
								className="text-md m-1 bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
							>
								🚀 Hash lists
							</Link>

							<Link
								href="/search"
								className="text-md m-1 bg-fuchsia-800 hover:bg-fuchsia-700 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
							>
								🔎 Search
							</Link>

							<Link
								href="/animesearch"
								className="text-md m-1 bg-pink-500 hover:bg-pink-400 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
							>
								🌸 Anime
							</Link>

							{rdUser && (
								<Link
									href="/stremio"
									className="text-md m-1 bg-purple-800 hover:bg-purple-700 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
								>
									🔮 Stremio
								</Link>
							)}

							<Link
								href=""
								onClick={() => showSettings()}
								className="text-md m-1 bg-gray-800 hover:bg-gray-700 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
							>
								⚙️ Settings
							</Link>
						</div>

						<div className="mb-2 h-max text-center leading-10">
							<Link
								href="/browse"
								className="text-sm m-1 bg-blue-600 hover:bg-blue-400 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
							>
								🏆 top
							</Link>

							<Link
								href="/browse/recent"
								className="text-sm m-1 bg-blue-600 hover:bg-blue-400 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
							>
								⏰ recent
							</Link>

							{browseTerms.map((term) => (
								<Link
									href={`/browse/${term.replace(/\W/gi, '')}`}
									className="text-sm m-1 bg-neutral-600 hover:bg-neutral-400 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
									key={term}
								>
									{term}
								</Link>
							))}

							<Link
								href={`/trakt/movies`}
								className="text-sm m-1 bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
							>
								🎥 movies
							</Link>
							<Link
								href={`/trakt/shows`}
								className="text-sm m-1 bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
							>
								📺 shows
							</Link>
							{traktUser && (
								<Link
									href={`/trakt/mylists`}
									className="text-sm m-1 bg-red-500 hover:bg-red-600 text-white font-bold py-1 px-2 rounded whitespace-nowrap"
								>
									🧏🏻‍♀️ my lists
								</Link>
							)}
						</div>

						<div className="text-sm mb-1 text-center cursor-pointer">
							✨{' '}
							<span onClick={() => setShowBookmarkletInfo(true)}>Bookmarklet❓</span>{' '}
							<a href={BOOKMARKLET} className="bg-blue-500 px-1">
								🤖DMM
							</a>
							{/* button to copy bookmarklet text */}
							<button
								className="text-xs bg-black mx-1"
								onClick={() => {
									navigator.clipboard.writeText(BOOKMARKLET);
									toast('Bookmarklet copied to clipboard');
								}}
							>
								(copy link)
							</button>
						</div>

						{showBookmarkletInfo && (
							<div
								className="text-xs mb-1 text-center  text-yellow-600"
								onClick={() => setShowBookmarkletInfo(false)}
							>
								<b>Drag the DMM button above to your bookmark bar</b> in any browser
								(except Edge apparently - for Edge you need to right-click it and
								save to your reading list). Then, when you&apos;re viewing a page in
								a supported website, click the DMM bookmark to inject DMM buttons
								into the page.
							</div>
						)}

						<div className="text-sm mb-1 text-center">
							✨ Get DMM browser extensions for{' '}
							<b>
								<a
									className="underline"
									href="https://chromewebstore.google.com/detail/debrid-media-manager/fahmnboccjgkbeeianfdiohbbgmgoibb"
									target="_blank"
								>
									Chrome
								</a>
							</b>{' '}
							and{' '}
							<b>
								<a
									className="underline"
									href="https://addons.mozilla.org/en-US/firefox/addon/debrid-media-manager/"
									target="_blank"
								>
									Firefox
								</a>
							</b>{' '}
							or the{' '}
							<b>
								<a
									className="underline"
									href="https://greasyfork.org/en/scripts/463268-debrid-media-manager"
									target="_blank"
								>
									userscript
								</a>
							</b>
						</div>
						<div className="text-sm mb-1 text-center">
							✨
							<a
								className="underline"
								href="https://github.com/debridmediamanager/zurg-testing"
								target="_blank"
							>
								<b>zurg</b>
							</a>{' '}
							mounts your Real-Debrid library and play your files directly from your
							computer or with Plex
						</div>
						<div className="text-sm mb-1 text-center">
							✨
							<a
								className="underline"
								href="https://elfhosted.com/guides/media/"
								target="_blank"
							>
								<b>ElfHosted</b>
							</a>{' '}
							provides automated zurg+Plex (and friends) hosting with $10 free credit
						</div>
						<div className="text-sm mb-1 text-center">
							✨
							<a
								className="text-azure bg-red-500 text-red-100 px-1"
								href="https://www.reddit.com/r/debridmediamanager/"
								target="_blank"
							>
								r/debridmediamanager
							</a>{' '}
							🤝 Sponsor this project&apos;s development on{' '}
							<a
								className="underline"
								href="https://github.com/sponsors/debridmediamanager"
								target="_blank"
							>
								Github
							</a>{' '}
							|{' '}
							<a
								className="underline"
								href="https://www.patreon.com/debridmediamanager"
								target="_blank"
							>
								Patreon
							</a>{' '}
							|{' '}
							<a
								className="underline"
								href="https://paypal.me/yowmamasita"
								target="_blank"
							>
								Paypal
							</a>
						</div>

						<div className="mb-2 h-max text-center leading-10">
							<button
								className="mx-1 bg-black hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs"
								onClick={() => handleClearCache()}
							>
								Clear library cache
							</button>
							{rdUser && (
								<button
									className="mx-1 bg-black hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs"
									onClick={() => handleLogout('rd:')}
								>
									Logout Real-Debrid
								</button>
							)}
							{adUser && (
								<button
									className="mx-1 bg-black hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs"
									onClick={() => handleLogout('ad:')}
								>
									Logout AllDebrid
								</button>
							)}
							{traktUser && (
								<button
									className="mx-1 bg-black hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs"
									onClick={() => handleLogout('trakt:')}
								>
									Logout Trakt
								</button>
							)}
							{(rdUser || adUser || traktUser) && (
								<button
									className="mx-1 bg-black hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs"
									onClick={() => handleLogout()}
								>
									Logout All
								</button>
							)}
						</div>
					</div>
				</>
			) : (
				<>
					<h1 className="text-xl text-center pb-4">Debrid Media Manager is loading...</h1>
					{deleting && (
						<h3 className="text-md text-center pb-4">
							If it gets stuck here, close all DMM tabs first
						</h3>
					)}
					<button
						className="mx-1 bg-black hover:bg-red-700 text-white font-bold py-1 px-2 rounded text-xs"
						onClick={() => handleLogout()}
					>
						Logout All
					</button>
				</>
			)}
		</div>
	);
}

export default withAuth(IndexPage);
